import { request } from './client';
import type { Page } from './teams.api';
// Bounded cursor cache permits sequential navigation without deep database skip.
// Scope includes the query/filter URL. Server validates cursor scope and roles.
const scopes = new Map<string, Map<number, string>>();
export async function paged<T>(base: string, page: number, limit = 20) {
  const scope = base + ':limit=' + limit;
  let cursors = scopes.get(scope);
  if (!cursors) {
    if (scopes.size >= 100) scopes.delete(scopes.keys().next().value!);
    cursors = new Map();
    scopes.set(scope, cursors);
  }
  if (page === 1) cursors.clear();
  const cursor = cursors.get(page);
  const url =
    base +
    (base.includes('?') ? '&' : '?') +
    `page=${cursor ? 1 : page}&limit=${limit}` +
    (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
  const result = await request<Page<T>>(url);
  if (result.lastCursor) cursors.set(result.pages, result.lastCursor);
  if (result.nextCursor) {
    if (cursors.size >= 300) cursors.delete(cursors.keys().next().value!);
    cursors.set(page + 1, result.nextCursor);
  }
  return { ...result, page };
}
export function clearPageCursors() {
  scopes.clear();
}
