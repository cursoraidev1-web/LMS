import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAnswer {
  questionId: mongoose.Types.ObjectId;
  value: string | string[];
  /** Points awarded (set on submit for auto-graded; set by admin for manual/short_answer) */
  pointsAwarded?: number;
  /** Max points for this question (stored at submit for consistent scoring) */
  pointsPossible?: number;
}

export type AttemptStatus = 'in_progress' | 'submitted';

/** Security event during exam (e.g. tab switch, fullscreen exit) */
export interface ISecurityEvent {
  type: string;
  at: Date;
}

export interface IExamAttempt extends Document {
  organizationId: string;
  examId: mongoose.Types.ObjectId;
  userId: string;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt?: Date;
  answers: IAnswer[];
  score?: number;
  maxScore?: number;
  passed?: boolean;
  /** Security events logged during the attempt (visibility change, fullscreen exit, etc.) */
  securityEvents?: ISecurityEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const answerSchema = new Schema<IAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    value: Schema.Types.Mixed,
    pointsAwarded: Number,
    pointsPossible: Number,
  },
  { _id: false }
);

const examAttemptSchema = new Schema<IExamAttempt>(
  {
    organizationId: { type: String, required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress' },
    startedAt: { type: Date, required: true, default: Date.now },
    submittedAt: { type: Date },
    answers: [answerSchema],
    score: Number,
    maxScore: Number,
    passed: Boolean,
    securityEvents: [{ type: String, at: Date }],
  },
  { timestamps: true }
);

examAttemptSchema.index({ organizationId: 1, examId: 1, userId: 1 });
examAttemptSchema.index({ userId: 1, status: 1 });

export const ExamAttempt: Model<IExamAttempt> =
  mongoose.models?.ExamAttempt ?? mongoose.model<IExamAttempt>('ExamAttempt', examAttemptSchema);
