/**
 * Product tags for the guest menu (handoff Part C): trimmed, blanks and
 * case-insensitive duplicates dropped, at most 10, each at most 30 characters.
 * The backend applies the same rules (422 otherwise); doing it here keeps the chip
 * input honest before the request goes out.
 */

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export type TagError = 'blank' | 'too-long' | 'duplicate' | 'too-many';

/** Thai copy for each refusal (the owner reads these in the product form). */
export const TAG_ERROR_TEXT: Record<TagError, string> = {
  blank: 'พิมพ์แท็กก่อนกดเพิ่ม',
  'too-long': `แท็กยาวได้ไม่เกิน ${MAX_TAG_LENGTH} ตัวอักษร`,
  duplicate: 'มีแท็กนี้แล้ว',
  'too-many': `ใส่แท็กได้ไม่เกิน ${MAX_TAGS} อัน`,
};

/** Unicode-aware length (Thai combining marks count as characters, like Python's len). */
const len = (s: string) => [...s].length;

const key = (s: string) => s.toLocaleLowerCase();

/**
 * Cleans a whole list the way the backend will: trims, drops blanks and
 * case-insensitive duplicates (first spelling wins), then caps at MAX_TAGS.
 * Tags longer than MAX_TAG_LENGTH are dropped (they would be rejected).
 */
export function normalizeTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim();
    if (!t || len(t) > MAX_TAG_LENGTH) continue;
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** Adds one typed tag to the list, or explains why it can't be added. */
export function addTag(tags: readonly string[], raw: string): { tags: string[]; error: TagError | null } {
  const t = raw.trim();
  if (!t) return { tags: [...tags], error: 'blank' };
  if (len(t) > MAX_TAG_LENGTH) return { tags: [...tags], error: 'too-long' };
  if (tags.some((x) => key(x) === key(t))) return { tags: [...tags], error: 'duplicate' };
  if (tags.length >= MAX_TAGS) return { tags: [...tags], error: 'too-many' };
  return { tags: [...tags, t], error: null };
}

/** Splits a pasted "a, b, c" (comma / newline separated) into candidate tags. */
export function splitTagInput(raw: string): string[] {
  return raw.split(/[,\n]/);
}

/**
 * The PATCH value for `tags`: `undefined` when unchanged (field omitted), `null`
 * when the owner removed every tag (the API clears on null), else the list.
 */
export function tagsPatch(before: readonly string[] | null | undefined, after: readonly string[]): string[] | null | undefined {
  const prev = before ?? [];
  const same = prev.length === after.length && prev.every((t, i) => t === after[i]);
  if (same) return undefined;
  return after.length === 0 ? null : [...after];
}
