import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCourseCategoryRef {
  category: mongoose.Types.ObjectId;
  order: number;
}

export type LiveCourseClassType = "live" | "live_offline" | "offline";

// One row in the admin-curated Schedule (Date / Subject / Time). `time` is a
// free-text slot label exactly as entered, e.g. "09:00-10:00 AM" — we don't
// parse it. Lives inside a ScheduleFolder.
export interface ILiveCourseScheduleEntry {
  _id: mongoose.Types.ObjectId;
  date: Date;
  subject: string;
  time: string;
  order: number;
}

// A folder grouping schedule entries. Top-to-bottom order via `order`.
export interface ILiveCourseScheduleFolder {
  _id: mongoose.Types.ObjectId;
  title: string;
  image?: string | null;
  order: number;
  status: boolean;
  entries: ILiveCourseScheduleEntry[];
}

export interface ILiveCourse extends Document {
  name: string;
  description: string;
  image: string;
  ordered: number;
  shareableLink?: string;
  withMaterial?: string;
  withoutMaterial?: string;
  level: string;
  // Drives the "Class Type" stat on the course header. "live_offline" renders
  // as "Live + Offline" on the client.
  classType: LiveCourseClassType;
  status: boolean;
  isPaid: boolean;
  isPopular: boolean;
  startTime?: Date | null;

  // Relations
  courseEducatorId?: mongoose.Types.ObjectId | null;
  packageCategoryId?: mongoose.Types.ObjectId | null;
  videoCategoryId?: mongoose.Types.ObjectId | null; // root VideoCategory folder

  // Adjacent content (kept for parity with Course)
  materialCategories: ILiveCourseCategoryRef[];
  examCategories: ILiveCourseCategoryRef[];

  // Admin-curated schedule, grouped into folders. Folders order top-to-bottom,
  // entries order within their folder.
  scheduleFolders: ILiveCourseScheduleFolder[];

  // Audit
  createdBy?: mongoose.Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

const materialCategoryRefSchema = new Schema<ILiveCourseCategoryRef>(
  {
    category: { type: Schema.Types.ObjectId, ref: "MaterialCategory", required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const examCategoryRefSchema = new Schema<ILiveCourseCategoryRef>(
  {
    category: { type: Schema.Types.ObjectId, ref: "ExamCategory", required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const scheduleEntrySchema = new Schema<ILiveCourseScheduleEntry>(
  {
    date:    { type: Date,   required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    time:    { type: String, required: true, trim: true, maxlength: 40 },
    order:   { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const scheduleFolderSchema = new Schema<ILiveCourseScheduleFolder>(
  {
    title:   { type: String,  required: true, trim: true, maxlength: 80 },
    image:   { type: String,  default: null },
    order:   { type: Number,  default: 0, min: 0 },
    status:  { type: Boolean, default: true },
    entries: { type: [scheduleEntrySchema], default: [] },
  },
  { _id: true }
);

const liveCourseSchema = new Schema<ILiveCourse>(
  {
    name:          { type: String, required: true, unique: true },
    description:   { type: String, required: true },
    image:         { type: String, required: true },
    ordered:       { type: Number, required: true },
    shareableLink:   { type: String, default: "" },
    withMaterial:    { type: String, default: "" },
    withoutMaterial: { type: String, default: "" },
    level:           { type: String, required: true },
    classType:       { type: String, enum: ["live", "live_offline", "offline"], default: "live" },
    status:          { type: Boolean, required: true, default: true },
    isPaid:          { type: Boolean, default: true },
    isPopular:       { type: Boolean, default: false, index: true },
    startTime:       { type: Date, default: null, index: true },

    courseEducatorId:   { type: Schema.Types.ObjectId, ref: "CourseEducator",  default: null },
    packageCategoryId:  { type: Schema.Types.ObjectId, ref: "PackageCategory", default: null, index: true },
    videoCategoryId:    { type: Schema.Types.ObjectId, ref: "VideoCategory",   default: null },

    materialCategories: { type: [materialCategoryRefSchema], default: [] },
    examCategories:     { type: [examCategoryRefSchema],     default: [] },
    scheduleFolders:    { type: [scheduleFolderSchema],      default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { collection: "ws_live_courses", timestamps: true }
);

export const LiveCourse = mongoose.model<ILiveCourse>("LiveCourse", liveCourseSchema);
