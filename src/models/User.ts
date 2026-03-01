import mongoose, { Schema, Document, Model } from 'mongoose';

export type Role = 'student' | 'admin' | 'super_admin';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  organizationId: string;
  twoFactorSecret?: string;
  twoFactorEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin', 'super_admin'], required: true },
    organizationId: { type: String, required: true },
    twoFactorSecret: { type: String },
    twoFactorEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.index({ organizationId: 1, email: 1 }, { unique: true });

export const User: Model<IUser> = mongoose.models?.User ?? mongoose.model<IUser>('User', userSchema);
