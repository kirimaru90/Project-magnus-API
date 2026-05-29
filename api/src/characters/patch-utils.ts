import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { AuthenticatedUser } from '../auth/jwt.strategy';

/** An element of a server-minted nanoid collection (perks, conditions, items). */
export interface Identified {
  id: string;
}

/** An incoming patch item: `id` optional (absent = create). */
export type PatchItem<T extends Identified> = Partial<T> & { id?: string };

/**
 * nanoid-collection diff (perks, conditions, inventory items).
 * Removes `deletedIds` first, then for each item:
 *  - `id` present & found     → shallow-merge
 *  - `id` present & not found → silently skip
 *  - `id` absent             → create with `nanoid(8)`
 */
export function patchCollectionArray<T extends Identified>(
  existing: T[],
  items: PatchItem<T>[] = [],
  deletedIds: string[] = [],
): T[] {
  const deleted = new Set(deletedIds);
  const result = existing.filter((el) => !deleted.has(el.id));

  for (const item of items) {
    if (item.id) {
      const idx = result.findIndex((el) => el.id === item.id);
      if (idx === -1) continue; // unknown id → silently skip
      result[idx] = { ...result[idx], ...item };
    } else {
      result.push({ ...item, id: nanoid(8) } as T);
    }
  }
  return result;
}

/**
 * Static-slug collection diff (skills only). Same shape as
 * {@link patchCollectionArray} but the `id` is a caller-supplied catalog
 * slug, never server-minted:
 *  - `id` present & found     → merge (change level)
 *  - `id` present & not found → insert (catalog attach)
 *  - `id` absent             → HTTP 400
 */
export function patchSlugCollection<T extends Identified>(
  existing: T[],
  items: PatchItem<T>[] = [],
  deletedIds: string[] = [],
): T[] {
  const deleted = new Set(deletedIds);
  const result = existing.filter((el) => !deleted.has(el.id));

  for (const item of items) {
    if (!item.id) {
      throw new BadRequestException(
        'Each skill item must carry a catalog slug id',
      );
    }
    const idx = result.findIndex((el) => el.id === item.id);
    if (idx === -1) {
      result.push({ ...item } as T); // insert
    } else {
      result[idx] = { ...result[idx], ...item }; // merge
    }
  }
  return result;
}

/**
 * Per-section whitelist of fields a non-admin (player) may write.
 *  - `[]`  → nothing writable (admin-only section)
 *  - `'*'` → the whole section is writable
 *  - list  → only those top-level keys are writable
 */
export const PLAYER_UPDATABLE_FIELDS: Record<string, string[] | '*'> = {
  special: [],
  skills: [],
  perks: [],
  actionPoints: ['paCurrent'],
  resources: ['caps', 'scraps'],
  status: '*',
  inventory: '*',
};

/**
 * Drop any section/field a non-admin may not write (no 403 — silent purge).
 * Admins bypass entirely. `'*'` allows the whole section; an empty list
 * drops everything.
 */
export function scrubPayload<T extends Record<string, unknown>>(
  section: string,
  payload: T,
  actor: AuthenticatedUser,
): Partial<T> {
  if (actor.role === 'admin') return payload;

  const allowed = PLAYER_UPDATABLE_FIELDS[section];
  if (allowed === '*') return payload;
  if (!allowed || allowed.length === 0) return {};

  const result: Partial<T> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      result[key as keyof T] = payload[key as keyof T];
    }
  }
  return result;
}
