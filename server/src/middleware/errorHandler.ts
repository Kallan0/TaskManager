import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: error.keyPattern?.email
          ? 'An account with this email already exists'
          : 'This membership or pending invitation already exists',
      },
    });
    return;
  }
  const known = error instanceof ApiError;
  const malformed = error?.type === 'entity.parse.failed';
  const tooLarge = error?.type === 'entity.too.large';
  if (!known && !malformed && !tooLarge)
    console.error(
      'Unexpected API error:',
      error instanceof Error ? error.name : 'Unknown',
    );
  res
    .status(known ? error.status : malformed ? 400 : tooLarge ? 413 : 500)
    .json({
      success: false,
      error: {
        code: known
          ? error.code
          : malformed
            ? 'INVALID_JSON'
            : tooLarge
              ? 'BODY_TOO_LARGE'
              : 'INTERNAL_ERROR',
        message: known
          ? error.message
          : malformed
            ? 'Invalid JSON body'
            : tooLarge
              ? 'Request body is too large'
              : 'Something went wrong. Please try again',
      },
    });
};
