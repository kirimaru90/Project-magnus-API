import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { AuthenticatedUser } from '../auth/jwt.strategy';

/** An element of a server-minted nanoid collection (perks, conditions, items). */
export interface Identified {
  id: string;
}

/** An incoming patch item: `id` optional (absent = create). */
export type PatchItem<T extends Identified> = Partial<T> & { id?: string };

/** An entry describing something the server silently dropped during a section PATCH. */
export type IgnoredEntry =
  | { section: string; reason: 'disallowed_section' }
  | { section: string; key: string; reason: 'unauthorized_field' }
  | { section: string; id: string; reason: 'unknown_id' };

/** Options controlling the id-less and unknown-id behaviour of patchCollectionArray. */
export type PatchCollectionOptions = {
  /** What to do when an item arrives without an `id`. */
  onIdless: 'create' | 'reject400';
  /** What to do when an `id` is present but not found in the existing array. */
  onUnknownId: 'skip' | 'insert';
  /**
   * Optional global pool of already-used ids. When `onIdless === 'create'`,
   * newly minted nanoids are checked against this set and regenerated on
   * collision. Updated in-place as new ids are minted.
   */
  idPool?: Set<string>;
};

/** Result of a patchCollectionArray call. */
export type PatchCollectionResult<T> = {
  result: T[];
  /** Ids present in `items` but not found — only populated when `onUnknownId === 'skip'`. */
  unknownIds: string[];
};

/**
 * Unified collection diff engine for nanoid and catalog-slug collections.
 *
 * Removes `deletedIds`, then for each item:
 *  - `id` present & found     → shallow-merge
 *  - `id` present & not found → `onUnknownId: 'skip'` tracks id in unknownIds; `'insert'` inserts as-is
 *  - `id` absent              → `onIdless: 'create'` mints nanoid(8); `'reject400'` throws 400
 *
 * nanoid collections (perks, conditions, inventory): `{ onIdless: 'create', onUnknownId: 'skip' }`
 * Catalog-slug collections (skills):                 `{ onIdless: 'reject400', onUnknownId: 'insert' }`
 */
export function patchCollectionArray<T extends Identified>(
  existing: T[],
  items: PatchItem<T>[] = [],
  deletedIds: string[] = [],
  options: PatchCollectionOptions,
): PatchCollectionResult<T> {
  const deleted = new Set(deletedIds);
  const result = existing.filter((el) => !deleted.has(el.id));
  const unknownIds: string[] = [];

  for (const item of items) {
    if (item.id) {
      const idx = result.findIndex((el) => el.id === item.id);
      if (idx === -1) {
        if (options.onUnknownId === 'insert') {
          result.push({ ...item } as T);
        } else {
          unknownIds.push(item.id);
        }
      } else {
        result[idx] = { ...result[idx], ...item };
      }
    } else {
      if (options.onIdless === 'reject400') {
        throw new BadRequestException(
          'Each skill item must carry a catalog slug id',
        );
      }
      let id: string;
      do {
        id = nanoid(8);
      } while (options.idPool?.has(id));
      if (options.idPool) options.idPool.add(id);
      result.push({ ...item, id } as T);
    }
  }
  return { result, unknownIds };
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

/** Result of a scrubPayload call. */
export type ScrubResult<T> = {
  scrubbed: Partial<T>;
  ignored: IgnoredEntry[];
};

/**
 * Drop any section/field a non-admin may not write (no 403 — silent purge).
 * Returns the scrubbed payload and ignored entries describing what was dropped.
 * Admins bypass entirely.
 */
export function scrubPayload<T extends Record<string, unknown>>(
  section: string,
  payload: T,
  actor: AuthenticatedUser,
): ScrubResult<T> {
  if (actor.role === 'admin') return { scrubbed: payload, ignored: [] };

  const allowed = PLAYER_UPDATABLE_FIELDS[section];
  if (allowed === '*') return { scrubbed: payload, ignored: [] };
  if (!allowed || allowed.length === 0) {
    return {
      scrubbed: {} as Partial<T>,
      ignored: [{ section, reason: 'disallowed_section' }],
    };
  }

  const scrubbed: Partial<T> = {};
  const ignored: IgnoredEntry[] = [];
  for (const key of Object.keys(payload)) {
    if (allowed.includes(key)) {
      scrubbed[key as keyof T] = payload[key as keyof T];
    } else {
      ignored.push({ section, key, reason: 'unauthorized_field' });
    }
  }
  return { scrubbed, ignored };
}
