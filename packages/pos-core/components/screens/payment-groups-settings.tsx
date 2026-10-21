'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Select } from '../app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { ApiError } from '@pos/core/lib/api-client';
import { usePaymentGroups, useUpdatePaymentGroups } from '@pos/core/hooks/use-cash';
import {
  draftFromConfig, draftToConfig, hasDraftErrors, validateGroupsDraft,
  GROUP_NAME_MAX, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
  type GroupsDraft, type PaymentMethod,
} from '@pos/core/lib/cash-reconciliation';

// Phone: the name row and the method rows keep 44px targets and 16px inputs.
const PG_CSS = `
.pg-input { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); font-family: inherit; font-size: 15px; box-sizing: border-box; }
.pg-input[aria-invalid='true'] { border-color: var(--color-danger); }
.pg-err { margin-top: 4px; font-size: 12px; color: var(--color-danger); }
.pg-method { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 240px); gap: 12px; align-items: center; padding: 8px 0; }
.pg-method + .pg-method { border-top: 1px solid var(--color-border); }
@media (max-width: 767px) {
  .pg-input { font-size: 16px; }
  .pg-method { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 8px; }
}
`;

/**
 * Owner / manager settings: which payment methods belong to which reconciliation group
 * (GET/PATCH /hr/payment-groups). Every method must sit in exactly one group — the editor
 * assigns by method, so a duplicate is impossible, and blocks Save while one is missing.
 */
export function PaymentGroupsSettings() {
  const toast = useToast();
  const q = usePaymentGroups();
  const save = useUpdatePaymentGroups();
  // null = showing the saved config; an object = unsaved edits.
  const [draft, setDraft] = useState<GroupsDraft | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const [serverError, setServerError] = useState<string | null>(null);

  const current = draft ?? (q.data ? draftFromConfig(q.data) : null);
  const errors = current ? validateGroupsDraft(current) : null;
  const dirty = draft != null;
  const blocked = !errors || hasDraftErrors(errors);

  const edit = (fn: (d: GroupsDraft) => GroupsDraft) => {
    if (!current) return;
    setServerError(null);
    setDraft(fn({ groups: current.groups.map(g => ({ ...g })), assignment: { ...current.assignment } }));
  };

  const addGroup = () => {
    const key = `n${nextKey}`;
    setNextKey(k => k + 1);
    edit(d => ({ ...d, groups: [...d.groups, { key, name: '' }] }));
    window.setTimeout(() => document.getElementById(`pg-name-${key}`)?.focus(), 0);
  };

  const removeGroup = (key: string) => edit(d => {
    const assignment = { ...d.assignment };
    for (const m of PAYMENT_METHODS) if (assignment[m] === key) assignment[m] = '';
    return { groups: d.groups.filter(g => g.key !== key), assignment };
  });

  const onSave = async () => {
    if (!current || blocked) return;
    try {
      await save.mutateAsync(draftToConfig(current));
      setDraft(null);
      toast({ kind: 'success', title: 'บันทึกกลุ่มการชำระเงินแล้ว', msg: 'ฟอร์มปิดกะจะใช้กลุ่มใหม่ทันที' });
    } catch (e: unknown) {
      const st = e instanceof ApiError ? e.status : null;
      setServerError(
        st === 403 ? 'เฉพาะผู้จัดการหรือเจ้าของร้านเท่านั้นที่แก้กลุ่มได้'
          : st === 422 ? 'ระบบไม่รับการตั้งค่านี้: ทุกช่องทางต้องอยู่ในกลุ่มเดียวเท่านั้น และทุกกลุ่มต้องมีชื่อ'
            : `บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <section aria-labelledby="pg-title" className="pad-phone" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, maxWidth: 720 }}>
      <style>{PG_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="cash" size={20} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 id="pg-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>กลุ่มการชำระเงิน (ปิดกะ)</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>ตอนปิดกะ ระบบรวมยอดขายตามกลุ่ม แล้วให้นับเงินจริงเทียบทีละกลุ่ม</div>
        </div>
      </div>

      {q.isLoading ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sr-only">กำลังโหลดกลุ่มการชำระเงิน…</span>
          <Skeleton height={44} radius="var(--radius-md)" />
          <Skeleton height={44} radius="var(--radius-md)" />
        </div>
      ) : q.isError || !current || !errors ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-danger)', fontSize: 14 }}>
          โหลดกลุ่มการชำระเงินไม่สำเร็จ
          <button type="button" onClick={() => void q.refetch()} className="pressable" style={{ minHeight: 40, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer' }}>ลองใหม่</button>
        </div>
      ) : (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>กลุ่ม</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {current.groups.map((g, i) => {
              const count = PAYMENT_METHODS.filter(m => current.assignment[m] === g.key).length;
              const err = errors.group[g.key];
              return (
                <li key={g.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input id={`pg-name-${g.key}`} className="pg-input" value={g.name} maxLength={GROUP_NAME_MAX + 20}
                      aria-label={`ชื่อกลุ่มที่ ${i + 1}`} placeholder="เช่น เงินสด, โอน / QR"
                      aria-invalid={err ? true : undefined} aria-describedby={err ? `pg-name-${g.key}-err` : undefined}
                      onChange={e => { const name = e.target.value; edit(d => ({ ...d, groups: d.groups.map(x => x.key === g.key ? { ...x, name } : x) })); }} />
                    {err && <div id={`pg-name-${g.key}-err`} className="pg-err">{err}</div>}
                  </div>
                  <span style={{ flexShrink: 0, minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 12, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{count} ช่องทาง</span>
                  <button type="button" onClick={() => removeGroup(g.key)} disabled={current.groups.length <= 1}
                    aria-label={`ลบกลุ่ม ${g.name || i + 1}`} title="ลบกลุ่ม" className="pressable"
                    style={{ flexShrink: 0, width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: current.groups.length <= 1 ? 'not-allowed' : 'pointer', opacity: current.groups.length <= 1 ? 0.4 : 1 }}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
          {errors.form.map(f => <div key={f} className="pg-err">{f}</div>)}
          <button type="button" onClick={addGroup} className="pressable"
            style={{ marginTop: 10, minHeight: 44, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border-strong)', background: 'transparent', color: 'var(--color-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={15} /> เพิ่มกลุ่ม
          </button>

          <h3 style={{ margin: '20px 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>ช่องทางชำระเงิน → กลุ่ม</h3>
          <div>
            {PAYMENT_METHODS.map((m: PaymentMethod) => {
              const err = errors.method[m];
              return (
                <div key={m} className="pg-method" data-method={m}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{PAYMENT_METHOD_LABEL[m]}</div>
                    {err && <div className="pg-err" style={{ marginTop: 0 }}>{err}</div>}
                  </div>
                  <Select
                    value={current.assignment[m]}
                    onChange={v => edit(d => ({ ...d, assignment: { ...d.assignment, [m]: v } }))}
                    ariaLabel={`กลุ่มของ ${PAYMENT_METHOD_LABEL[m]}`}
                    placeholder="— เลือกกลุ่ม —"
                    options={current.groups.map((g, i) => ({ value: g.key, label: g.name.trim() || `กลุ่มที่ ${i + 1}` }))}
                  />
                </div>
              );
            })}
          </div>

          {serverError && <div role="alert" className="pg-err" style={{ marginTop: 12, fontSize: 13 }}>{serverError}</div>}
          <div className="stack-phone" style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
            <button type="button" onClick={onSave} disabled={!dirty || blocked || save.isPending} className="pressable"
              style={{ minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontSize: 14, fontWeight: 600, cursor: !dirty || blocked ? 'not-allowed' : 'pointer', opacity: !dirty || blocked ? 0.5 : 1 }}>
              {save.isPending ? 'กำลังบันทึก…' : 'บันทึกกลุ่ม'}
            </button>
            {dirty && (
              <button type="button" onClick={() => { setDraft(null); setServerError(null); }} disabled={save.isPending} className="pressable"
                style={{ minHeight: 44, padding: '10px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>
                ยกเลิกการแก้ไข
              </button>
            )}
            {dirty && blocked && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>แก้จุดที่แจ้งเตือนก่อนบันทึก</span>}
          </div>
        </>
      )}
    </section>
  );
}
