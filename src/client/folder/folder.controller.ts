import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Folder, FolderType } from "../../models/customer/Folder.model";
import { FolderItem, FolderItemKind } from "../../models/customer/FolderItem.model";
import { Material } from "../../models/course/Material.model";
import { Video } from "../../models/course/Video.model";

const KIND_MODELS: Record<FolderItemKind, mongoose.Model<any>> = {
  material: Material,
  video: Video,
  ebook: Material, // unused for the split CRUDs; kept for type completeness
};

const DEFAULT_NAME: Record<FolderType, string> = {
  video: "My Videos",
  material: "My Materials",
};

const ALLOWED_KIND: Record<FolderType, FolderItemKind> = {
  video: "video",
  material: "material",
};

function userId(req: Request): string | null {
  return req.user?.id ?? null;
}

/**
 * Ensure both default folders ("My Videos", "My Materials") exist for a customer.
 * Idempotent — safe to call on every signup and from backfill scripts.
 */
export async function ensureDefaultFolders(customerId: string | Types.ObjectId) {
  const types: FolderType[] = ["video", "material"];
  await Promise.all(
    types.map((type) =>
      Folder.updateOne(
        { customerId, type, isDefaultFolder: true },
        { $setOnInsert: { customerId, type, name: DEFAULT_NAME[type], isDefaultFolder: true } },
        { upsert: true }
      )
    )
  );
}

function makeFolderController(type: FolderType) {
  const allowedKind = ALLOWED_KIND[type];

  const list = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      await ensureDefaultFolders(uid);

      const folders = await Folder.find({ customerId: uid, type })
        .sort({ isDefaultFolder: -1, createdAt: -1 })
        .lean();
      const counts = await FolderItem.aggregate([
        { $match: { customerId: new Types.ObjectId(uid), kind: allowedKind } },
        { $group: { _id: "$folderId", count: { $sum: 1 } } },
      ]);
      const countByFolder = new Map<string, number>(counts.map((c) => [String(c._id), c.count]));

      const data = folders.map((f) => ({
        ...f,
        isDefaultFolder: !!f.isDefaultFolder,
        itemCount: countByFolder.get(String(f._id)) ?? 0,
      }));
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const create = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const name = (req.body?.name ?? "").toString().trim();
      if (!name) return res.status(400).json({ success: false, message: "name is required." });
      if (name.length > 120)
        return res.status(400).json({ success: false, message: "name too long (max 120)." });

      try {
        const folder = await Folder.create({ customerId: uid, name, type, isDefaultFolder: false });
        return res.status(201).json({ success: true, data: folder });
      } catch (err: any) {
        if (err?.code === 11000)
          return res
            .status(409)
            .json({ success: false, message: "A folder with this name already exists." });
        throw err;
      }
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const detail = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid folder id." });

      const folder = await Folder.findOne({ _id: id, customerId: uid, type }).lean();
      if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });

      const { page = "1", limit = "20" } = req.query as Record<string, string>;
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
      const skip = (pageNum - 1) * limitNum;

      const filter = { folderId: id, customerId: uid, kind: allowedKind };

      const [items, total] = await Promise.all([
        FolderItem.find(filter).sort({ addedAt: -1 }).skip(skip).limit(limitNum).lean(),
        FolderItem.countDocuments(filter),
      ]);

      const refIds = items.map((it) => it.refId);
      const refs = refIds.length ? await KIND_MODELS[allowedKind].find({ _id: { $in: refIds } }).lean() : [];
      const refMap = new Map<string, any>();
      for (const r of refs as any[]) refMap.set(String(r._id), r);

      const list = items.map((it) => ({
        _id: it._id,
        kind: it.kind,
        refId: it.refId,
        addedAt: it.addedAt,
        ref: refMap.get(String(it.refId)) ?? null,
      }));

      return res.status(200).json({
        success: true,
        data: { folder: { ...folder, isDefaultFolder: !!folder.isDefaultFolder }, list },
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const update = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid folder id." });

      const name = (req.body?.name ?? "").toString().trim();
      if (!name) return res.status(400).json({ success: false, message: "name is required." });
      if (name.length > 120)
        return res.status(400).json({ success: false, message: "name too long (max 120)." });

      try {
        const folder = await Folder.findOneAndUpdate(
          { _id: id, customerId: uid, type },
          { $set: { name } },
          { new: true }
        ).lean();
        if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });
        return res.status(200).json({ success: true, data: folder });
      } catch (err: any) {
        if (err?.code === 11000)
          return res
            .status(409)
            .json({ success: false, message: "A folder with this name already exists." });
        throw err;
      }
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const remove = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid folder id." });

      const existing = await Folder.findOne({ _id: id, customerId: uid, type }).select("isDefaultFolder").lean();
      if (!existing) return res.status(404).json({ success: false, message: "Folder not found." });

      await session.withTransaction(async () => {
        await FolderItem.deleteMany({ folderId: id, customerId: uid }, { session });
        if (!existing.isDefaultFolder) {
          await Folder.deleteOne({ _id: id, customerId: uid, type }, { session });
        }
      });

      return res.status(200).json({
        success: true,
        message: existing.isDefaultFolder ? "Folder emptied." : "Folder deleted.",
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    } finally {
      session.endSession();
    }
  };

  const addItem = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: "Invalid folder id." });

      const refId = req.body?.refId as string;
      if (!refId || !mongoose.Types.ObjectId.isValid(refId))
        return res.status(400).json({ success: false, message: "Invalid refId." });

      const folder = await Folder.findOne({ _id: id, customerId: uid, type }).select("_id");
      if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });

      const refExists = await KIND_MODELS[allowedKind].exists({ _id: refId });
      if (!refExists)
        return res.status(404).json({ success: false, message: `${allowedKind} not found.` });

      const existing = await FolderItem.findOne({ folderId: id, kind: allowedKind, refId });
      if (existing) return res.status(200).json({ success: true, data: existing, deduped: true });

      const item = await FolderItem.create({ folderId: id, customerId: uid, kind: allowedKind, refId });
      return res.status(201).json({ success: true, data: item });
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await FolderItem.findOne({
          folderId: req.params.id,
          kind: allowedKind,
          refId: req.body?.refId,
        });
        return res.status(200).json({ success: true, data: existing, deduped: true });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const removeItem = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      const { id, itemId } = req.params as { id: string; itemId: string };
      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(itemId))
        return res.status(400).json({ success: false, message: "Invalid id(s)." });

      const folder = await Folder.findOne({ _id: id, customerId: uid, type }).select("_id");
      if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });

      const removed = await FolderItem.findOneAndDelete({
        _id: itemId,
        folderId: id,
        customerId: uid,
        kind: allowedKind,
      });
      if (!removed) return res.status(404).json({ success: false, message: "Item not found." });
      return res.status(200).json({ success: true, message: "Item removed." });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  // GET /{video|material}-folders/all-items
  // Returns every folder the customer owns for this type, with its items + joined refs.
  // Mirrors the per-folder `detail` shape but in one call, and only counts items whose
  // underlying Material/Video still exists — so list length matches the dashboard count.
  const allItems = async (req: Request, res: Response) => {
    try {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

      await ensureDefaultFolders(uid);

      const folders = await Folder.find({ customerId: uid, type })
        .sort({ isDefaultFolder: -1, createdAt: -1 })
        .lean();
      if (!folders.length) return res.status(200).json({ success: true, data: [] });

      const folderIds = folders.map((f) => f._id);
      const items = await FolderItem.find({
        folderId: { $in: folderIds },
        customerId: new Types.ObjectId(uid),
        kind: allowedKind,
      })
        .sort({ addedAt: -1 })
        .lean();

      const refIds = items.map((it) => it.refId);
      const refs = refIds.length
        ? await KIND_MODELS[allowedKind].find({ _id: { $in: refIds } }).lean()
        : [];
      const refMap = new Map<string, any>();
      for (const r of refs as any[]) refMap.set(String(r._id), r);

      const itemsByFolder = new Map<string, any[]>();
      for (const it of items) {
        const ref = refMap.get(String(it.refId));
        if (!ref) continue;
        const key = String(it.folderId);
        const row = { _id: it._id, kind: it.kind, refId: it.refId, addedAt: it.addedAt, ref };
        const arr = itemsByFolder.get(key);
        if (arr) arr.push(row);
        else itemsByFolder.set(key, [row]);
      }

      const data = folders.map((f) => ({
        folder: { ...f, isDefaultFolder: !!f.isDefaultFolder },
        list: itemsByFolder.get(String(f._id)) ?? [],
      }));

      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  return { list, create, detail, update, remove, addItem, removeItem, allItems };
}

export const videoFolderController = makeFolderController("video");
export const materialFolderController = makeFolderController("material");
