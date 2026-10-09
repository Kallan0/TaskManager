import { Schema, model } from 'mongoose';
const schema = new Schema({
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  joinedAt: { type: Date, default: Date.now },
});
schema.index({ team: 1, user: 1 }, { unique: true });
schema.index({ user: 1, team: 1 });
export const Membership = model('TeamMembership', schema);
