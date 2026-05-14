import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCourseCategoryRef {
  category: mongoose.Types.ObjectId;
  order: number;
}

export type LiveCourseClassType = "live" | "live_offline" | "offline";

// A downloadable file shown in the "Time Table" file list on the Schedule tab.
export interface ILiveCourseTimetableFile {
  title: string;
  fileUrl: string;
  order: number;
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

  // Relations
  courseEducatorId?: mongoose.Types.ObjectId | null;
  courseSubjectCategoryId?: mongoose.Types.ObjectId | null;
  videoCategoryId?: mongoose.Types.ObjectId | null; // root VideoCategory folder

  // Adjacent content (kept for parity with Course)
  materialCategories: ILiveCourseCategoryRef[];
  examCategories: ILiveCourseCategoryRef[];

  // Timetable PDFs/files surfaced on the Schedule tab (the "Time Table" list).
  timetableFiles: ILiveCourseTimetableFile[];

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

const timetableFileSchema = new Schema<ILiveCourseTimetableFile>(
  {
    title:   { type: String, required: true },
    fileUrl: { type: String, required: true },
    order:   { type: Number, default: 0 },
  },
  { _id: false }
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

    courseEducatorId:        { type: Schema.Types.ObjectId, ref: "CourseEducator",        default: null },
    courseSubjectCategoryId: { type: Schema.Types.ObjectId, ref: "CourseSubjectCategory", default: null },
    videoCategoryId:         { type: Schema.Types.ObjectId, ref: "VideoCategory",         default: null },

    materialCategories: { type: [materialCategoryRefSchema], default: [] },
    examCategories:     { type: [examCategoryRefSchema],     default: [] },
    timetableFiles:     { type: [timetableFileSchema],       default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { collection: "ws_live_courses", timestamps: true }
);

export const LiveCourse = mongoose.model<ILiveCourse>("LiveCourse", liveCourseSchema);
