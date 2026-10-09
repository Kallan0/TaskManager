import { Schema, model } from 'mongoose';
import { User } from '../auth/user.model.js';
export function memberSearchKeys(name: string, email: string) {
  return [
    ...new Set(
      [name, email, ...name.split(/\s+/)].map((value) => value.toLowerCase()),
    ),
  ];
}
const schema = new Schema({
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  joinedAt: { type: Date, default: Date.now },
  searchKeys: { type: [String], default: [] },
});
schema.pre('validate', async function () {
  if (this.isNew && !this.searchKeys.length) {
    const user = await User.findById(this.user).select('name email');
    if (user) this.searchKeys = memberSearchKeys(user.name, user.email);
  }
});
schema.index({ team: 1, user: 1 }, { unique: true });
schema.index({ user: 1, team: 1 });
schema.index({ team: 1, joinedAt: 1, _id: 1 });
schema.index({ user: 1, joinedAt: -1, _id: -1 });
schema.index({ team: 1, searchKeys: 1 });
export const Membership = model('TeamMembership', schema);
