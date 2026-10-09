import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    invitedEmail: { type: String, required: true },
    role: { type: String, enum: ['admin', 'member'], required: true },
    tokenHash: { type: String, required: true, select: false },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: [
        'pending',
        'requested',
        'accepted',
        'declined',
        'revoked',
        'expired',
      ],
      default: 'pending',
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index(
  { team: 1, invitedEmail: 1 },
  {
    name: 'active_invitation_v2',
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'requested'] } },
  },
);
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ invitedEmail: 1, status: 1, expiresAt: 1 });
schema.index({ requestedBy: 1, status: 1, expiresAt: 1 });
schema.index({ team: 1, createdAt: -1, _id: -1 });
export const Invitation = model('Invitation', schema);
