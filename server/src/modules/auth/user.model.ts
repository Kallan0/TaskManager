import { Schema, model } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);
export const User = model('User', userSchema);
export type PublicUser = { id: string; name: string; email: string };
export function publicUser(user: {
  _id: { toString(): string };
  name: string;
  email: string;
}): PublicUser {
  return { id: user._id.toString(), name: user.name, email: user.email };
}
