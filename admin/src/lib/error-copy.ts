import { ApiError } from './admin-api';

/**
 * Turn an API failure into something a founder can act on.
 *
 * The backend writes `error.message` to be human-readable, so it is a decent
 * fallback — but a handful of statuses mean something specific on this surface
 * and deserve the recovery step spelled out. `context` picks the right one when
 * the same status code means different things on different screens.
 */
export type ErrorContext =
  | 'login'
  | 'tenant-create'
  | 'tenant-update'
  | 'store-create'
  | 'assign-package'
  | 'store-resume'
  | 'package-create'
  | 'generic';

export type RateLimitKind = 'ip' | 'account';

/**
 * A 429 comes from one of two limiters that share the code TOO_MANY_REQUESTS:
 * the per-IP limiter (5/min, sends Retry-After) and the per-email login throttle
 * (5 failures / 15 min, sends none). Trust the header first because that is the
 * documented difference; fall back to the message in case a proxy strips it.
 */
export function rateLimitKind(err: ApiError): RateLimitKind {
  if (err.retryAfter != null) return 'ip';
  if (/rate limit exceeded/i.test(err.message)) return 'ip';
  return 'account';
}

export function errorMessage(err: unknown, context: ErrorContext = 'generic'): string {
  if (!(err instanceof ApiError)) {
    if (err instanceof Error && err.message) return err.message;
    return 'เกิดข้อผิดพลาดที่ไม่รู้จัก ลองใหม่อีกครั้ง';
  }

  if (err.status === 429) {
    if (context !== 'login') {
      return err.retryAfter != null
        ? `ส่งคำขอถี่เกินไป รออีก ${err.retryAfter} วินาทีแล้วลองใหม่`
        : 'ส่งคำขอถี่เกินไป รอสักครู่แล้วลองใหม่';
    }
    // The per-email lockout blocks the CORRECT password too — say so, or the
    // founder assumes they mistyped again and burns the whole 15 minutes.
    return rateLimitKind(err) === 'account'
      ? 'ใส่รหัสผ่านผิดหลายครั้งเกินไป บัญชีนี้ถูกล็อกชั่วคราว 15 นาที — ระหว่างนี้ต่อให้รหัสถูกก็เข้าไม่ได้'
      : 'ส่งคำขอเข้าสู่ระบบถี่เกินไปจากเครือข่ายนี้ รอสักครู่แล้วลองใหม่';
  }

  if (err.status === 401) {
    // Login deliberately returns the same 401 for unknown email, wrong password
    // and deactivated admin — don't try to distinguish them here either.
    return context === 'login'
      ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      : 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  }

  if (err.status === 404 && context === 'tenant-update') {
    return 'ไม่พบลูกค้ารายนี้ — อาจถูกลบไปแล้ว ลองรีเฟรชหน้า';
  }

  if (err.status === 409) {
    switch (context) {
      case 'tenant-create':
        return 'slug นี้มีลูกค้ารายอื่นใช้แล้ว ลองใช้ slug อื่น';
      case 'store-create':
        return 'slug นี้ถูกใช้ไปแล้ว — slug ของสาขาไม่ซ้ำกันทั้งระบบ ไม่ใช่แค่ในลูกค้ารายนี้ ลองเติมชื่อลูกค้านำหน้า';
      case 'assign-package':
        return 'แพ็กเกจนี้เลิกขายแล้ว จึงกำหนดให้ลูกค้ารายใหม่ไม่ได้ เลือกแพ็กเกจที่ยังขายอยู่';
      case 'store-resume':
        return 'เปิดสาขานี้ไม่ได้เพราะบริษัทลูกค้ายังอยู่ในโหมดอ่านอย่างเดียว — เปิดใช้งานบริษัทก่อน';
      case 'package-create':
        return 'key นี้มีแพ็กเกจใช้อยู่แล้ว ตั้ง key ใหม่';
      default:
        return err.message;
    }
  }

  if (err.status === 422) {
    // Only reachable on a race — the edit form disables save when nothing changed.
    // The exact message is pinned by a backend test, so matching on it is safe.
    if (context === 'tenant-update' && /no fields to update/i.test(err.message)) {
      return 'ไม่มีการเปลี่ยนแปลง — แก้ไขข้อมูลอย่างน้อยหนึ่งช่องก่อนบันทึก';
    }
    // Both a null and an empty name land here (they carry different messages).
    if (context === 'tenant-update' && /name/i.test(err.message)) {
      return 'บันทึกไม่สำเร็จ — ชื่อบริษัทเว้นว่างไม่ได้';
    }
    return err.message || 'ข้อมูลที่กรอกไม่ถูกต้อง ตรวจอีกครั้ง';
  }

  if (err.status >= 500) {
    return 'เซิร์ฟเวอร์มีปัญหา ลองใหม่อีกครั้ง หากยังไม่หายแจ้งทีมหลังบ้าน';
  }

  return err.message;
}

/**
 * Map a 422's Pydantic `details` onto form fields, so the message lands on the
 * input that caused it instead of only in a toast.
 * Returns `{ fieldName: message }` for the fields it can place.
 */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  const out: Record<string, string> = {};
  for (const d of err.details) {
    // loc looks like ["body", "slug"] — the last string segment is the field.
    const field = [...(d.loc ?? [])].reverse().find((p): p is string => typeof p === 'string' && p !== 'body');
    if (field && d.msg && !out[field]) out[field] = d.msg;
  }
  return out;
}
