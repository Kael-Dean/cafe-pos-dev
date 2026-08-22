'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { storeCreateSchema, type StoreCreateForm } from '@/lib/schemas';
import { suggestStoreSlug } from '@/lib/format';
import { TextField } from './ui/field';
import { Button } from './ui/button';
import { Note, Mono } from './ui/layout-bits';
import Icon from './ui/icon';
import { useToast } from './ui/toast';

/* ------------------------------------------------------------------ form -- */

interface StoreFormProps {
  tenantSlug: string;
  /** A store created under a suspended tenant is created suspended — say so up front. */
  tenantIsActive: boolean;
  submitting: boolean;
  /** Server-side message for the slug field (409 collisions land here). */
  slugError?: string;
  onSubmit: (values: StoreCreateForm) => void;
  footerExtra?: React.ReactNode;
  submitLabel?: string;
}

export function StoreForm({
  tenantSlug, tenantIsActive, submitting, slugError, onSubmit, footerExtra, submitLabel = 'สร้างสาขา',
}: StoreFormProps) {
  const {
    register, handleSubmit, watch, setValue, formState: { errors },
  } = useForm<StoreCreateForm>({
    resolver: zodResolver(storeCreateSchema),
    defaultValues: { name: '', slug: '', owner_name: '', vat_enabled: false },
  });

  const name = watch('name');
  const slug = watch('slug');
  const [slugTouched, setSlugTouched] = useState(false);

  // Store slugs are unique across ALL clients, so an unprefixed "central" is a
  // collision waiting to happen. Suggest a prefixed one until the user edits it.
  useEffect(() => {
    if (slugTouched) return;
    setValue('slug', suggestStoreSlug(tenantSlug, name ?? ''), { shouldValidate: false });
  }, [name, slugTouched, setValue, tenantSlug]);

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      {!tenantIsActive && (
        <Note tone="warning">
          ลูกค้ารายนี้อยู่ในโหมดอ่านอย่างเดียว สาขาที่สร้างตอนนี้จะถูกสร้างในสถานะอ่านอย่างเดียวตามไปด้วย
          และจะเปิดใช้งานได้ก็ต่อเมื่อเปิดใช้งานบริษัทก่อน
        </Note>
      )}

      <TextField
        label="ชื่อสาขา"
        required
        placeholder="เช่น สาขาสีลม"
        error={errors.name?.message}
        {...register('name')}
      />

      <TextField
        label="slug ของสาขา"
        required
        hint={
          <>
            slug ไม่ซ้ำกัน<strong>ทั้งระบบ</strong> ไม่ใช่แค่ในลูกค้ารายนี้ เพราะพนักงานหน้าร้านเข้า POS ด้วย slug + PIN
            — ขึ้นต้นด้วยชื่อลูกค้าไว้จะชนน้อยกว่า
          </>
        }
        error={slugError ?? errors.slug?.message}
        placeholder="acme-silom"
        {...register('slug', {
          onChange: () => setSlugTouched(true),
        })}
      />
      {!slugTouched && slug && (
        <p style={{ marginTop: -10, fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)' }}>
          แนะนำอัตโนมัติจากชื่อสาขา — แก้ได้
        </p>
      )}

      <TextField
        label="ชื่อเจ้าของร้าน"
        required
        hint="ระบบจะสร้างผู้ใช้ระดับ OWNER ให้สาขานี้พร้อม PIN หนึ่งชุด"
        placeholder="เช่น สมชาย"
        error={errors.owner_name?.message}
        {...register('owner_name')}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 'var(--fs-14)' }}>
        <input type="checkbox" {...register('vat_enabled')} style={{ width: 17, height: 17, accentColor: 'var(--color-primary)' }} />
        เปิดใช้ VAT สำหรับสาขานี้
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {footerExtra}
        <Button type="submit" variant="primary" loading={submitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- PIN reveal -- */

interface PinRevealProps {
  storeName: string;
  storeSlug: string;
  pin: string;
  /** False when the store inherited a suspended tenant's state. */
  storeIsActive: boolean;
  onDone: () => void;
  doneLabel?: string;
}

/**
 * The PIN is returned exactly once and only its hash is stored — there is no
 * endpoint to read it again and no reset. So: show it big, make copying easy,
 * and refuse to move on until the founder confirms they saved it.
 */
export function PinReveal({ storeName, storeSlug, pin, storeIsActive, onDone, doneLabel = 'เสร็จสิ้น' }: PinRevealProps) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ kind: 'warning', title: 'คัดลอกอัตโนมัติไม่ได้', msg: 'เลือกตัวเลขแล้วคัดลอกด้วยตัวเอง' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Note tone="danger">
        <strong>PIN นี้แสดงครั้งเดียวเท่านั้น</strong> ระบบเก็บไว้เป็นค่าแฮชอย่างเดียว
        ไม่มีทางเรียกดูซ้ำและยังรีเซ็ตไม่ได้ ถ้าหายเจ้าของร้านจะเข้า POS ไม่ได้
      </Note>

      <div
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-5)',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 'var(--fs-13)', color: 'var(--color-text-secondary)' }}>
          PIN เจ้าของร้าน {storeName}
        </p>
        <p
          className="num"
          style={{
            marginTop: 'var(--space-2)',
            fontFamily: 'var(--font-num)',
            fontSize: 'var(--fs-32)',
            fontWeight: 'var(--fw-bold)',
            letterSpacing: '0.22em',
            textIndent: '0.22em',
          }}
        >
          {pin}
        </p>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="ghost" size="sm" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'คัดลอกแล้ว' : 'คัดลอก PIN'}
          </Button>
        </div>
      </div>

      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>
        เจ้าของร้านเข้า POS ด้วย slug <Mono>{storeSlug}</Mono> คู่กับ PIN นี้
        {!storeIsActive && ' — แต่สาขานี้ถูกสร้างในสถานะอ่านอย่างเดียว เพราะบริษัทลูกค้ายังถูกพักอยู่'}
      </p>

      <label
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
          padding: 'var(--space-3) var(--space-4)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-14)', lineHeight: 1.5,
        }}
      >
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          style={{ width: 17, height: 17, marginTop: 2, accentColor: 'var(--color-primary)' }}
        />
        บันทึก PIN นี้เรียบร้อยแล้ว และส่งให้เจ้าของร้านแล้ว
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" disabled={!saved} onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}
