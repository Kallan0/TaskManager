import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    team: { type: Schema.Types.ObjectId, required: true },
    user: { type: Schema.Types.ObjectId, required: true },
    actor: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
schema.index({ team: 1, user: 1 }, { unique: true });
export const AssignmentCleanup = model('AssignmentCleanup', schema);
