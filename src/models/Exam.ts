import mongoose, { Schema, Document, Model } from 'mongoose';

export type ExamStatus = 'draft' | 'published' | 'archived';

export interface IExam extends Document {
  organizationId: string;
  title: string;
  description?: string;
  status: ExamStatus;
  scheduledAt?: Date;
  durationMinutes: number;
  passMark: number; // percentage 0-100
  questionIds: mongoose.Types.ObjectId[];
  shuffleQuestions: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const examSchema = new Schema<IExam>(
  {
    organizationId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    scheduledAt: { type: Date },
    durationMinutes: { type: Number, required: true, min: 1 },
    passMark: { type: Number, required: true, min: 0, max: 100, default: 60 },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    shuffleQuestions: { type: Boolean, default: true },
  },
  { timestamps: true }
);

examSchema.index({ organizationId: 1, status: 1 });
examSchema.index({ organizationId: 1, scheduledAt: 1 });

export const Exam: Model<IExam> =
  mongoose.models?.Exam ?? mongoose.model<IExam>('Exam', examSchema);
