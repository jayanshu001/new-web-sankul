import mongoose, { Schema, Document } from "mongoose";

export interface IVideoCategory extends Document {
  title: string;
  slug: string;
  // Normalized form of `title` (trim + lowercase + collapsed whitespace). Used
  // as the dedupe key for subject-based auto-folder resolution when a live
  // session's recording is promoted — sessions with subject "Maths" / "maths"
  // / "Maths " all land in the same folder. Unique per liveCourseId.
  subjectKey?: string | null;
  image: string | null;
  courseId?: mongoose.Types.ObjectId;
  liveCourseId?: mongoose.Types.ObjectId;
  childCategoryIds: mongoose.Types.ObjectId[];
  educatorId?: mongoose.Types.ObjectId;
  order_by: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const videoCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true },
    subjectKey: { type: String, default: null },
    // Optional — auto-created folders (from subject-based recording promotion)
    // have no image until an admin sets one.
    image: { type: String, default: null },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null, index: true },
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", default: null, index: true },
    childCategoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "VideoCategory" }],
      default: [],
      index: true,
    },
    educatorId: { type: Schema.Types.ObjectId, ref: "CourseEducator", default: null },
    order_by: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: one subject folder per live course. Partial filter
// limits enforcement to live-course folders that actually have a subjectKey,
// so legacy folders (subjectKey: null) and recorded-course folders aren't
// affected.
videoCategorySchema.index(
  { liveCourseId: 1, subjectKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      liveCourseId: { $type: "objectId" },
      subjectKey: { $type: "string" },
    },
  }
);

export const VideoCategory = mongoose.model<IVideoCategory>("VideoCategory", videoCategorySchema, "ws_video_categories");
