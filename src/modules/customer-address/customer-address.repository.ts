import { prisma } from "../../config/prisma";
import type { AddressCreateInput, AddressUpdateInput } from "./customer-address.types";

/** "9664796376" → 9664796376n; null/empty → null. Throws on non-numeric. */
const toPhoneBig = (v?: string | null): bigint | null => {
  if (v === null || v === undefined || v === "") return null;
  if (!/^\d+$/.test(v)) throw new Error(`Invalid phone (non-numeric): ${v}`);
  return BigInt(v);
};

const toPincodeInt = (v: string): number => {
  if (!/^\d+$/.test(v)) throw new Error(`Invalid pincode (non-numeric): ${v}`);
  return Number(v);
};

export const customerAddressRepository = {
  /** Active addresses for a customer, newest first. */
  listByCustomer: (customerId: number) =>
    prisma.customerAddress.findMany({
      where: { userId: customerId, status: true },
      orderBy: { created_at: "desc" },
    }),

  /** Single address scoped to its owner (prevents cross-customer reads). */
  findOwned: (id: number, customerId: number) =>
    prisma.customerAddress.findFirst({ where: { id, userId: customerId } }),

  create: (input: AddressCreateInput) =>
    prisma.customerAddress.create({
      data: {
        name: input.name,
        phone: toPhoneBig(input.phone) ?? BigInt(0),
        alternate_phone: toPhoneBig(input.alternatePhone),
        email: input.email ?? "",
        address: input.address,
        address_2: input.address2 ?? "",
        city: input.city,
        state: input.stateId ?? null,
        cityId: input.cityId ?? null,
        pincode: toPincodeInt(input.pincode),
        label: input.label ?? null,
        isDefault: false,
        userId: input.customerId,
        status: input.status ?? true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    }),

  /** Owner-scoped update; returns count so caller can 404 on 0. */
  updateOwned: (id: number, customerId: number, input: AddressUpdateInput) =>
    prisma.customerAddress.updateMany({
      where: { id, userId: customerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: toPhoneBig(input.phone) ?? BigInt(0) } : {}),
        ...(input.alternatePhone !== undefined
          ? { alternate_phone: toPhoneBig(input.alternatePhone) }
          : {}),
        ...(input.email !== undefined ? { email: input.email ?? "" } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.address2 !== undefined ? { address_2: input.address2 ?? "" } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.stateId !== undefined ? { state: input.stateId ?? null } : {}),
        ...(input.cityId !== undefined ? { cityId: input.cityId ?? null } : {}),
        ...(input.pincode !== undefined ? { pincode: toPincodeInt(input.pincode) } : {}),
        ...(input.label !== undefined ? { label: input.label ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updated_at: new Date(),
      },
    }),

  /** Soft-delete (status=false), owner-scoped. Returns count. */
  softDeleteOwned: (id: number, customerId: number) =>
    prisma.customerAddress.updateMany({
      where: { id, userId: customerId },
      data: { status: false, updated_at: new Date() },
    }),

  /**
   * Set one address default: clear isDefault on the customer's other rows, then
   * set it on the target. Wrapped in a transaction so reads never see two
   * defaults. Returns the count set on the target (0 → not found / not owned).
   */
  setDefault: async (id: number, customerId: number) => {
    const [, setRes] = await prisma.$transaction([
      prisma.customerAddress.updateMany({
        where: { userId: customerId, id: { not: id } },
        data: { isDefault: false },
      }),
      prisma.customerAddress.updateMany({
        where: { id, userId: customerId, status: true },
        data: { isDefault: true, updated_at: new Date() },
      }),
    ]);
    return setRes.count;
  },
};
