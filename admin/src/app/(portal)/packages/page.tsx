'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  usePackages, useCreatePackage, useUpdatePackage, type PackageRead,
} from '@/hooks/use-packages';
import { useTenants } from '@/hooks/use-tenants';
import { errorMessage, fieldErrors } from '@/lib/error-copy';
import { formatBaht } from '@/lib/format';
import { normalizePrice, packageFormSchema, parseFeatureKeys, type PackageForm } from '@/lib/schemas';
import { DataTable, type Column } from '@/components/ui/data-table';
import { PageHeader, Note, Mono } from '@/components/ui/layout-bits';
import { Tag, FeatureChip } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { TextField, TextAreaField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export default function PackagesPage() {
  const { data, isLoading, isError, error, refetch } = usePackages();
  const { data: tenants } = useTenants();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PackageRead | null>(null);

  /** How many clients each package is currently sold to — counted client-side. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tenants ?? []) {
      if (t.package_key) counts.set(t.package_key, (counts.get(t.package_key) ?? 0) + 1);
    }
    return counts;
  }, [tenants]);

  const columns: Column<PackageRead>[] = [
    {
      key: 'key',
      header: 'key',
      render: (p) => (
        <>
          <Mono>{p.key}</Mono>
          <div style={{ fontWeight: 'var(--fw-semibold)' }}>{p.name_th}</div>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)' }}>{p.name_en}</div>
        </>
      ),
    },
    {
      key: 'features',
      header: 'ฟีเจอร์',
      render: (p) =>
        p.feature_keys.length === 0 ? (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-12)' }}>ไม่มี</span>
        ) : (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 320 }}>
            {p.feature_keys.map((f) => <FeatureChip key={f}>{f}</FeatureChip>)}
          </span>
        ),
    },
    {
      key: 'price',
      header: 'ราคา',
      numeric: true,
      render: (p) => (
        <>
          <div className="num">{formatBaht(p.price_monthly)} <span style={{ color: 'var(--color-text-muted)' }}>/ด.</span></div>
          <div className="num" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-12)' }}>
            {formatBaht(p.price_annual)} /ปี
          </div>
        </>
      ),
    },
    {
      key: 'tenants',
      header: 'ลูกค้าที่ใช้',
      numeric: true,
      width: '100px',
      render: (p) => <span className="num">{usage.get(p.key) ?? 0}</span>,
    },
    {
      key: 'status',
      header: 'สถานะ',
      render: (p) => (p.is_active ? <Tag tone="success">ขายอยู่</Tag> : <Tag tone="neutral">เลิกขายแล้ว</Tag>),
    },
    {
      key: 'actions',
      header: 'จัดการ',
      width: '96px',
      render: (p) => (
        <Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(p)}>แก้ไข</Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="แพ็กเกจ"
        lede="ชุดฟีเจอร์ที่เราขาย กำหนดให้ลูกค้ารายไหนก็เปิดฟีเจอร์ชุดนั้นให้ทุกสาขาของเขา"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>สร้างแพ็กเกจ</Button>
        }
      />

      <DataTable
        caption="รายการแพ็กเกจ"
        columns={columns}
        rows={data ?? []}
        rowKey={(p) => p.key}
        loading={isLoading}
        error={isError ? errorMessage(error) : null}
        onRetry={() => refetch()}
        empty={{
          icon: 'box',
          title: 'ยังไม่มีแพ็กเกจ',
          body: 'สร้างแพ็กเกจแรก แล้วค่อยกำหนดให้ลูกค้าแต่ละราย',
          action: <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>สร้างแพ็กเกจ</Button>,
        }}
      />

      {creating && <CreatePackageModal onClose={() => setCreating(false)} />}
      {editing && (
        <EditPackageModal
          pkg={editing}
          affectedTenants={usage.get(editing.key) ?? 0}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- create -- */

function CreatePackageModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePackage();
  const toast = useToast();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<PackageForm>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: { key: '', name_th: '', name_en: '', feature_keys: '', price_monthly: '', price_annual: '' },
  });

  const features = watch('feature_keys');

  const submit = handleSubmit(async (v) => {
    setServerErrors({});
    try {
      await create.mutateAsync({
        key: v.key.trim(),
        name_th: v.name_th.trim(),
        name_en: v.name_en.trim(),
        feature_keys: parseFeatureKeys(v.feature_keys),
        price_monthly: normalizePrice(v.price_monthly),
        price_annual: normalizePrice(v.price_annual),
      });
      toast({ kind: 'success', title: 'สร้างแพ็กเกจแล้ว', msg: v.key.trim() });
      onClose();
    } catch (err) {
      const msg = errorMessage(err, 'package-create');
      const fields = fieldErrors(err);
      setServerErrors(Object.keys(fields).length ? fields : { key: msg });
      toast({ kind: 'danger', title: 'สร้างแพ็กเกจไม่สำเร็จ', msg });
    }
  });

  return (
    <Modal
      title="สร้างแพ็กเกจ"
      onClose={onClose}
      busy={create.isPending}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}>สร้างแพ็กเกจ</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Note tone="warning">
          <strong>key เปลี่ยนทีหลังไม่ได้</strong> ระบบไม่มีการเปลี่ยนชื่อ key — ตั้งให้ดีตั้งแต่แรก
        </Note>

        <TextField
          label="key"
          required
          hint="A–Z ตัวใหญ่ ตัวเลข และขีดล่าง 2–40 ตัวอักษร"
          placeholder="BOARDGAME"
          error={serverErrors.key ?? errors.key?.message}
          {...register('key', {
            onChange: (e) => setValue('key', e.target.value.toUpperCase(), { shouldValidate: false }),
          })}
        />
        <TextField label="ชื่อภาษาไทย" required placeholder="แพ็กเกจบอร์ดเกม" error={errors.name_th?.message} {...register('name_th')} />
        <TextField label="ชื่อภาษาอังกฤษ" required placeholder="Board Game" error={errors.name_en?.message} {...register('name_en')} />

        <TextAreaField
          label="feature keys"
          hint="บรรทัดละหนึ่ง key เช่น vertical.boardgame"
          placeholder={'vertical.boardgame'}
          error={errors.feature_keys?.message}
          value={features}
          {...register('feature_keys')}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <TextField label="ราคา/เดือน (บาท)" required inputMode="decimal" placeholder="2500.00" error={errors.price_monthly?.message} {...register('price_monthly')} />
          <TextField label="ราคา/ปี (บาท)" required inputMode="decimal" placeholder="25000.00" error={errors.price_annual?.message} {...register('price_annual')} />
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ edit -- */

function EditPackageModal({
  pkg, affectedTenants, onClose,
}: { pkg: PackageRead; affectedTenants: number; onClose: () => void }) {
  const update = useUpdatePackage();
  const toast = useToast();
  const [phase, setPhase] = useState<'form' | 'confirm'>('form');
  const [pending, setPending] = useState<PackageForm | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<PackageForm>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: {
      key: pkg.key,
      name_th: pkg.name_th,
      name_en: pkg.name_en,
      feature_keys: pkg.feature_keys.join('\n'),
      price_monthly: pkg.price_monthly,
      price_annual: pkg.price_annual,
    },
  });

  const features = watch('feature_keys');
  const nextFeatures = parseFeatureKeys(features ?? '');
  const featuresChanged =
    nextFeatures.length !== pkg.feature_keys.length ||
    nextFeatures.some((f, i) => f !== pkg.feature_keys[i]);

  const added = nextFeatures.filter((f) => !pkg.feature_keys.includes(f));
  const removed = pkg.feature_keys.filter((f) => !nextFeatures.includes(f));

  const apply = async (v: PackageForm, isActive = pkg.is_active) => {
    try {
      await update.mutateAsync({
        key: pkg.key,
        payload: {
          name_th: v.name_th.trim(),
          name_en: v.name_en.trim(),
          feature_keys: parseFeatureKeys(v.feature_keys),
          price_monthly: normalizePrice(v.price_monthly),
          price_annual: normalizePrice(v.price_annual),
          is_active: isActive,
        },
      });
      toast({ kind: 'success', title: 'บันทึกแพ็กเกจแล้ว', msg: pkg.key });
      onClose();
    } catch (err) {
      toast({ kind: 'danger', title: 'บันทึกแพ็กเกจไม่สำเร็จ', msg: errorMessage(err) });
      setPhase('form');
    }
  };

  const submit = handleSubmit((v) => {
    // Editing feature_keys re-derives entitlements for every tenant on this
    // package immediately. Make that visible before it happens.
    if (featuresChanged && affectedTenants > 0) {
      setPending(v);
      setPhase('confirm');
      return;
    }
    void apply(v);
  });

  // Retiring also saves the rest of the form, so it has to pass the same
  // validation — otherwise a half-filled field turns a retire into a 422.
  const toggleActive = handleSubmit((v) => apply(v, !pkg.is_active));

  if (phase === 'confirm' && pending) {
    return (
      <Modal
        title="ยืนยันการแก้ฟีเจอร์"
        onClose={() => setPhase('form')}
        busy={update.isPending}
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPhase('form')} disabled={update.isPending}>ย้อนกลับ</Button>
            <Button variant="danger" onClick={() => apply(pending)} loading={update.isPending}>
              ยืนยัน แก้ฟีเจอร์
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Note tone="danger">
            มีลูกค้า <strong>{affectedTenants} ราย</strong> ใช้แพ็กเกจ <Mono>{pkg.key}</Mono> อยู่ตอนนี้
            สิทธิ์ของทุกสาขาจะถูกคำนวณใหม่<strong>ทันที</strong> ไม่ใช่ฉบับร่าง
          </Note>

          {added.length > 0 && (
            <div>
              <p style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>เพิ่ม</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {added.map((f) => <FeatureChip key={f}>+ {f}</FeatureChip>)}
              </div>
            </div>
          )}

          {removed.length > 0 && (
            <div>
              <p style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>เอาออก</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {removed.map((f) => <FeatureChip key={f}>− {f}</FeatureChip>)}
              </div>
              <p style={{ marginTop: 8, fontSize: 'var(--fs-12)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                ลูกค้าที่ใช้ฟีเจอร์เหล่านี้อยู่จะเข้าถึงไม่ได้ตั้งแต่คำขอถัดไป
              </p>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`แก้ไข ${pkg.key}`}
      onClose={onClose}
      busy={update.isPending}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit} loading={update.isPending}>บันทึก</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <TextField label="key" hint="key เป็นค่าถาวร เปลี่ยนไม่ได้" disabled value={pkg.key} readOnly />

        <TextField label="ชื่อภาษาไทย" required error={errors.name_th?.message} {...register('name_th')} />
        <TextField label="ชื่อภาษาอังกฤษ" required error={errors.name_en?.message} {...register('name_en')} />

        <TextAreaField
          label="feature keys"
          hint={
            affectedTenants > 0
              ? `บรรทัดละหนึ่ง key — ตอนนี้มีลูกค้า ${affectedTenants} รายใช้แพ็กเกจนี้อยู่ การแก้มีผลทันที`
              : 'บรรทัดละหนึ่ง key'
          }
          error={errors.feature_keys?.message}
          value={features}
          {...register('feature_keys')}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <TextField label="ราคา/เดือน (บาท)" required inputMode="decimal" error={errors.price_monthly?.message} {...register('price_monthly')} />
          <TextField label="ราคา/ปี (บาท)" required inputMode="decimal" error={errors.price_annual?.message} {...register('price_annual')} />
        </div>

        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingTop: 'var(--space-4)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 'var(--space-4)', flexWrap: 'wrap',
          }}
        >
          <div style={{ maxWidth: '46ch' }}>
            <p style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)' }}>
              {pkg.is_active ? 'แพ็กเกจนี้ยังขายอยู่' : 'แพ็กเกจนี้เลิกขายแล้ว'}
            </p>
            <p style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginTop: 2 }}>
              {pkg.is_active
                ? 'เลิกขายแล้วจะกำหนดให้ลูกค้ารายใหม่ไม่ได้ แต่ลูกค้าที่ถืออยู่ยังใช้ต่อได้ตามปกติ'
                : 'กลับมาขายอีกครั้งได้ ลูกค้ารายใหม่จะเลือกแพ็กเกจนี้ได้'}
            </p>
          </div>
          <Button variant="ghost" onClick={toggleActive} disabled={update.isPending}>
            {pkg.is_active ? 'เลิกขายแพ็กเกจนี้' : 'กลับมาขายอีกครั้ง'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
