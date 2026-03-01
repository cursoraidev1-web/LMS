import mongoose, { Schema, Document, Model } from 'mongoose';

export type QuestionType = 'mcq_single' | 'mcq_multiple' | 'true_false' | 'short_answer';

export interface IQuestionOption {
  text: string;
  isCorrect: boolean;
}

export interface IQuestion extends Document {
  organizationId: string;
  type: QuestionType;
  body: string;
  options?: IQuestionOption[]; // for mcq_single, mcq_multiple, true_false
  correctAnswer?: string; // for short_answer; for true_false "true"|"false"
  points: number;
  createdAt: Date;
  updatedAt: Date;
}

const questionOptionSchema = new Schema<IQuestionOption>(
  { text: { type: String, required: true }, isCorrect: { type: Boolean, default: false } },
  { _id: false }
);

const questionSchema = new Schema<IQuestion>(
  {
    organizationId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['mcq_single', 'mcq_multiple', 'true_false', 'short_answer'],
      required: true,
    },
    body: { type: String, required: true, trim: true },
    options: [questionOptionSchema],
    correctAnswer: { type: String, trim: true },
    points: { type: Number, required: true, min: 0, default: 1 },
  },
  { timestamps: true }
);

export const Question: Model<IQuestion> =
  mongoose.models?.Question ?? mongoose.model<IQuestion>('Question', questionSchema);
