import { Schema, model } from 'mongoose';
const eventSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  taskTitle: { type: String, required: true },
  changes: { type: Schema.Types.Mixed, default: [] },
  createdAt: { type: Date, default: Date.now },
});
const schema = new Schema(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 4000 },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    history: { type: [eventSchema], default: [] },
  },
  { timestamps: true },
);
schema.index({ team: 1, task: 1, deletedAt: 1, createdAt: 1, _id: 1 });
schema.index({ 'history._id': 1 });
export const TaskComment = model('TaskComment', schema);
