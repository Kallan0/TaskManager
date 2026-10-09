import { describe, expect, it } from 'vitest';
import { getTrustedOrigins } from '../src/config/origins.js';

describe('Trusted frontend origins', () => {
  it('allows the matching localhost alias only in local development', () => {
    const origins = getTrustedOrigins('http://localhost:5173', 'development');
    expect(origins.has('http://localhost:5173')).toBe(true);
    expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    expect(origins.has('http://127.0.0.1:5174')).toBe(false);
    expect(origins.has('https://localhost:5173')).toBe(false);
    expect(origins.has('http://localhost.attacker.example:5173')).toBe(false);
    expect(origins.has('null')).toBe(false);
  });
  it('handles a configured IP address and leaves remote development origins exact', () => {
    expect(
      getTrustedOrigins('http://127.0.0.1:5173', 'development').has(
        'http://localhost:5173',
      ),
    ).toBe(true);
    expect([
      ...getTrustedOrigins('https://preview.example.com', 'development'),
    ]).toEqual(['https://preview.example.com']);
  });
  it('never adds aliases in production', () => {
    expect([
      ...getTrustedOrigins('https://localhost:5173', 'production'),
    ]).toEqual(['https://localhost:5173']);
  });
});
