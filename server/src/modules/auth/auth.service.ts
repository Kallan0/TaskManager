import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { User, publicUser } from './user.model.js';
import { registerSchema, loginSchema } from './auth.validation.js';

const dummyHash = await bcrypt.hash('unusable-dummy-password', 12);
function session(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  tokenVersion: number;
}) {
  return {
    user: publicUser(user),
    token: jwt.sign({ version: user.tokenVersion }, env.SESSION_SECRET, {
      subject: user._id.toString(),
      expiresIn: '8h',
      algorithm: 'HS256',
      issuer: 'team-task-planner',
      audience: 'planner-web',
    }),
  };
}
export async function register(input: unknown) {
  const data = registerSchema.parse(input);
  const passwordHash = await bcrypt.hash(data.password, 12);
  return session(
    await User.create({ name: data.name, email: data.email, passwordHash }),
  );
}
export async function login(input: unknown) {
  const data = loginSchema.parse(input);
  const user = await User.findOne({ email: data.email }).select(
    '+passwordHash +tokenVersion',
  );
  const valid = await bcrypt.compare(
    data.password,
    user?.passwordHash ?? dummyHash,
  );
  if (!user || !valid)
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Email or password is incorrect',
    );
  return session(user);
}
export async function authenticateToken(token?: string) {
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, env.SESSION_SECRET, {
      algorithms: ['HS256'],
      issuer: 'team-task-planner',
      audience: 'planner-web',
    });
    if (
      typeof decoded === 'string' ||
      !decoded.sub ||
      !/^[a-f0-9]{24}$/.test(decoded.sub)
    )
      throw new Error('Invalid token');
    payload = decoded;
  } catch {
    throw new ApiError(
      401,
      'UNAUTHENTICATED',
      'Your session expired. Please sign in',
    );
  }
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || user.tokenVersion !== payload.version)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again');
  return publicUser(user);
}
