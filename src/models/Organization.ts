import mongoose, { Schema, Document, Model } from 'mongoose';

export type OrganizationStatus = 'active' | 'suspended' | 'trial';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  status: OrganizationStatus;
  settings?: {
    maxUsers?: number;
    maxExams?: number;
    allowRegistration?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    status: { type: String, enum: ['active', 'suspended', 'trial'], default: 'active' },
    settings: {
      maxUsers: Number,
      maxExams: Number,
      allowRegistration: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

organizationSchema.index({ status: 1 });

export const Organization: Model<IOrganization> =
  mongoose.models?.Organization ?? mongoose.model<IOrganization>('Organization', organizationSchema);
