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
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 10000 },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'in_review', 'done'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    priorityRank: { type: Number, default: 2 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    approvalStatus: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'approved',
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '', maxlength: 500 },
    history: { type: [eventSchema], default: [] },
  },
  { timestamps: true },
);
schema.index({ team: 1, deletedAt: 1, status: 1, createdAt: -1 });
schema.index({ team: 1, assignee: 1, deletedAt: 1 });
schema.index({ team: 1, dueDate: 1, deletedAt: 1 });
schema.index({ team: 1, 'history.createdAt': -1 });
schema.index({ team: 1, approvalStatus: 1, deletedAt: 1, createdAt: -1 });
schema.index({
  team: 1,
  deletedAt: 1,
  approvalStatus: 1,
  priorityRank: 1,
  _id: -1,
});
schema.index({ title: 'text', description: 'text' });
schema.index({ 'history._id': 1 });
schema.index({ team: 1, deletedAt: 1, createdAt: -1, _id: -1 });
schema.index({ team: 1, deletedAt: 1, dueDate: 1, _id: 1 });
export const Task = model('Task', schema);
// Legacy missions without an approval field remain approved.
export const approvedMissionFilter = {
  approvalStatus: { $nin: ['pending', 'rejected'] },
};
