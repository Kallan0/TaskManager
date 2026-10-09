import { z } from 'zod';
import { ApiError } from './ApiError.js';
const shape = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/),
  date: z.iso.datetime(),
  scope: z.string().max(500),
});
export function encodeCursor(id: string, date: Date, scope: string) {
  return Buffer.from(
    JSON.stringify({ id, date: date.toISOString(), scope }),
  ).toString('base64url');
}
export function decodeCursor(value: string, scope: string) {
  try {
    const result = shape.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (result.scope !== scope) throw new Error('scope');
    return { id: result.id, date: new Date(result.date) };
  } catch {
    throw new ApiError(
      400,
      'INVALID_CURSOR',
      'This page cursor is invalid. Start from the first page',
    );
  }
}

const orderedShape = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/),
  value: z.union([z.string().max(100), z.number(), z.null()]),
  scope: z.string().max(3000),
});
export function encodeOrderedCursor(
  id: string,
  value: string | number | null,
  scope: string,
) {
  return Buffer.from(JSON.stringify({ id, value, scope })).toString(
    'base64url',
  );
}
export function decodeOrderedCursor(value: string, scope: string) {
  try {
    const cursor = orderedShape.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (cursor.scope !== scope) throw new Error('scope');
    return cursor;
  } catch {
    throw new ApiError(
      400,
      'INVALID_CURSOR',
      'This page cursor is invalid. Start from the first page',
    );
  }
}
