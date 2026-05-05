import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Folder } from "../../models/customer/Folder.model";
import { FolderItem, FolderItemKind } from "../../models/customer/FolderItem.model";
import { Material } from "../../models/course/Material.model";
import { Video } from "../../models/course/Video.model";
import { Ebook } from "../../models/ebook/Ebook.model";

const KIND_MODELS: Record<FolderItemKind, mongoose.Model<any>> = {
  material: Material,
  video: Video,
  ebook: Ebook,
};

function userId(req: Request): string | null {
  return req.user?.id ?? null;
}

// GET /client/folders
export const listFolders = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const folders = await Folder.find({ customerId: uid }).sort({ createdAt: -1 }).lean();
    const counts = await FolderItem.aggregate([
      { $match: { customerId: new Types.ObjectId(uid) } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);
    const countByFolder = new Map<string, number>(counts.map((c) => [String(c._id), c.count]));

    const data = folders.map((f) => ({
      ...f,
      itemCount: countByFolder.get(String(f._id)) ?? 0,
    }));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /client/folders  { name }
export const createFolder = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const name = (req.body?.name ?? "").toString().trim();
    if (!name) return res.status(400).json({ success: false, message: "name is required." });
    if (name.length > 120)
      return res.status(400).json({ success: false, message: "name too long (max 120)." });

    try {
      const folder = await Folder.create({ customerId: uid, name });
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

// GET /client/folders/:id  (paginated items)
export const getFolderDetail = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid folder id." });

    const folder = await Folder.findOne({ _id: id, customerId: uid }).lean();
    if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });

    const { page = "1", limit = "20", kind } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { folderId: id, customerId: uid };
    if (kind === "material" || kind === "video" || kind === "ebook") filter.kind = kind;

    const [items, total] = await Promise.all([
      FolderItem.find(filter).sort({ addedAt: -1 }).skip(skip).limit(limitNum).lean(),
      FolderItem.countDocuments(filter),
    ]);

    // Hydrate refs grouped by kind
    const byKind: Record<FolderItemKind, Types.ObjectId[]> = { material: [], video: [], ebook: [] };
    for (const it of items) byKind[it.kind as FolderItemKind].push(it.refId);

    const [materials, videos, ebooks] = await Promise.all([
      byKind.material.length ? Material.find({ _id: { $in: byKind.material } }).lean() : [],
      byKind.video.length ? Video.find({ _id: { $in: byKind.video } }).lean() : [],
      byKind.ebook.length ? Ebook.find({ _id: { $in: byKind.ebook } }).lean() : [],
    ]);
    const refMap = new Map<string, any>();
    for (const m of materials as any[]) refMap.set(`material:${m._id}`, m);
    for (const v of videos as any[]) refMap.set(`video:${v._id}`, v);
    for (const e of ebooks as any[]) refMap.set(`ebook:${e._id}`, e);

    const list = items.map((it) => ({
      _id: it._id,
      kind: it.kind,
      refId: it.refId,
      addedAt: it.addedAt,
      ref: refMap.get(`${it.kind}:${it.refId}`) ?? null,
    }));

    return res.status(200).json({
      success: true,
      data: { folder, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /client/folders/:id
export const deleteFolder = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid folder id." });

    let removed = false;
    await session.withTransaction(async () => {
      const folder = await Folder.findOneAndDelete({ _id: id, customerId: uid }, { session });
      if (!folder) return;
      await FolderItem.deleteMany({ folderId: id, customerId: uid }, { session });
      removed = true;
    });

    if (!removed) return res.status(404).json({ success: false, message: "Folder not found." });
    return res.status(200).json({ success: true, message: "Folder deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// POST /client/folders/:id/items  { kind, refId }
export const addFolderItem = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid folder id." });

    const kind = req.body?.kind as FolderItemKind;
    const refId = req.body?.refId as string;
    if (!["material", "video", "ebook"].includes(kind))
      return res.status(400).json({ success: false, message: "kind must be material|video|ebook." });
    if (!refId || !mongoose.Types.ObjectId.isValid(refId))
      return res.status(400).json({ success: false, message: "Invalid refId." });

    const folder = await Folder.findOne({ _id: id, customerId: uid }).select("_id");
    if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });

    const refExists = await KIND_MODELS[kind].exists({ _id: refId });
    if (!refExists)
      return res.status(404).json({ success: false, message: `${kind} not found.` });

    // Idempotent attach: silent no-op on duplicate
    const existing = await FolderItem.findOne({ folderId: id, kind, refId });
    if (existing) return res.status(200).json({ success: true, data: existing, deduped: true });

    const item = await FolderItem.create({ folderId: id, customerId: uid, kind, refId });
    return res.status(201).json({ success: true, data: item });
  } catch (error: any) {
    if (error?.code === 11000) {
      const existing = await FolderItem.findOne({
        folderId: req.params.id,
        kind: req.body?.kind,
        refId: req.body?.refId,
      });
      return res.status(200).json({ success: true, data: existing, deduped: true });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /client/folders/:id/items/:itemId
export const removeFolderItem = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { id, itemId } = req.params as { id: string; itemId: string };
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(itemId))
      return res.status(400).json({ success: false, message: "Invalid id(s)." });

    const removed = await FolderItem.findOneAndDelete({
      _id: itemId,
      folderId: id,
      customerId: uid,
    });
    if (!removed) return res.status(404).json({ success: false, message: "Item not found." });
    return res.status(200).json({ success: true, message: "Item removed." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
