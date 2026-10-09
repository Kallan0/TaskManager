import { Schema, model } from 'mongoose';
const schema = new Schema({
  team: { type: Schema.Types.ObjectId, required: true },
  task: { type: Schema.Types.ObjectId, required: true },
  actor: { type: Schema.Types.ObjectId, required: true },
  taskTitle: { type: String, required: true },
  type: { type: String, required: true },
  changes: { type: Schema.Types.Mixed, default: [] },
  visibleToMembers: { type: Boolean, required: true },
  createdAt: { type: Date, required: true },
  // Operational history, with an explicit 365-day retention window.
  purgeAt: { type: Date, required: true },
});
schema.index({ team: 1, visibleToMembers: 1, createdAt: -1, _id: -1 });
schema.index({ team: 1, task: 1, createdAt: -1, _id: -1 });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const Activity = model('Activity', schema);
