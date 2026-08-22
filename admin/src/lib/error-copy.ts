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
  | 'store-create'
  | 'assign-package'
  | 'store-resume'
  | 'package-create'
  | 'generic';

export function errorMessage(err: unknown, context: ErrorContext = 'generic'): string {
  if (!(err instanceof ApiError)) {
    if (err instanceof Error && err.message) return err.message;
    return 'เกิดข้อผิดพลาดที่ไม่รู้จัก ลองใหม่อีกครั้ง';
  }

  if (err.status === 429) {
    return context === 'login'
      ? 'ลองเข้าสู่ระบบผิดหลายครั้งเกินไป รอ 1 นาทีแล้วลองใหม่'
      : 'ส่งคำขอถี่เกินไป รอสักครู่แล้วลองใหม่';
  }

  if (err.status === 401) {
    // Login deliberately returns the same 401 for unknown email, wrong password
    // and deactivated admin — don't try to distinguish them here either.
    return context === 'login'
      ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      : 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
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
