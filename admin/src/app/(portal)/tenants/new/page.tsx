'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { tenantCreateSchema, toTenantPayload, type TenantCreateForm } from '@/lib/schemas';
import { errorMessage, fieldErrors } from '@/lib/error-copy';
import { formatBaht } from '@/lib/format';
import { useAssignPackage, useCreateTenant, type TenantRead } from '@/hooks/use-tenants';
import { useCreateStore, type StoreCreatedResponse } from '@/hooks/use-stores';
import { usePackages } from '@/hooks/use-packages';
import type { StoreCreateForm } from '@/lib/schemas';
import { PageHeader, Note, Section, Mono } from '@/components/ui/layout-bits';
import { TextField, Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PinReveal, StoreForm } from '@/components/store-create';
import { useToast } from '@/components/ui/toast';
import Icon from '@/components/ui/icon';

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'สร้างบริษัทลูกค้า' },
  { n: 2, label: 'กำหนดแพ็กเกจ' },
  { n: 3, label: 'สร้างสาขาแรก' },
];

/** The API has no single onboarding call, and the order matters — see step 2. */
export default function NewTenantPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [tenant, setTenant] = useState<TenantRead | null>(null);

  return (
    <>
      <PageHeader
        title="เพิ่มลูกค้าใหม่"
        lede="สามขั้น: สร้างบริษัท → กำหนดแพ็กเกจ → สร้างสาขาแรกพร้อม PIN เจ้าของร้าน"
        actions={
          <Link href="/tenants" className="btn btn-ghost">
            <Icon name="chevronLeft" size={16} />
            กลับไปหน้ารายชื่อ
          </Link>
        }
      />

      <Stepper current={step} />

      <div style={{ maxWidth: 620, marginTop: 'var(--space-6)' }}>
        {step === 1 && (
          <TenantStep
            onCreated={(t) => { setTenant(t); setStep(2); }}
          />
        )}

        {step === 2 && tenant && (
          <PackageStep
            tenant={tenant}
            onDone={(t) => { setTenant(t); setStep(3); }}
          />
        )}

        {step === 3 && tenant && (
          <StoreStep
            tenant={tenant}
            onFinish={() => {
              toast({ kind: 'success', title: 'เพิ่มลูกค้าเรียบร้อย', msg: tenant.name });
              router.push(`/tenants/${tenant.id}`);
            }}
          />
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- stepper -- */

function Stepper({ current }: { current: Step }) {
  return (
    <ol
      style={{
        display: 'flex', gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0,
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s) => {
        const done = current > s.n;
        const active = current === s.n;
        return (
          <li
            key={s.n}
            aria-current={active ? 'step' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px',
              borderRadius: 'var(--radius-pill)',
              background: active ? 'var(--color-accent-50)' : 'transparent',
              border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: active ? 'var(--color-primary-700)' : done ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: 'var(--fs-13)',
              fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
            }}
          >
            <span
              aria-hidden
              className="num"
              style={{
                width: 20, height: 20, flexShrink: 0,
                display: 'grid', placeItems: 'center',
                borderRadius: 'var(--radius-pill)',
                fontSize: 11, fontWeight: 'var(--fw-bold)',
                background: done ? 'var(--color-success)' : active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                color: done ? '#fff' : active ? 'var(--color-on-accent)' : 'var(--color-text-muted)',
              }}
            >
              {done ? <Icon name="check" size={12} color="#fff" strokeWidth={2.4} /> : s.n}
            </span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------- step 1 -- */

function TenantStep({ onCreated }: { onCreated: (t: TenantRead) => void }) {
  const create = useCreateTenant();
  const toast = useToast();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const { register, handleSubmit, formState: { errors } } = useForm<TenantCreateForm>({
    resolver: zodResolver(tenantCreateSchema),
    defaultValues: { name: '', slug: '', legal_name: '', tax_id: '', billing_email: '', billing_address: '' },
  });

  const submit = handleSubmit(async (values) => {
    setServerErrors({});
    try {
      const t = await create.mutateAsync(toTenantPayload(values));
      onCreated(t);
    } catch (err) {
      const fields = fieldErrors(err);
      const msg = errorMessage(err, 'tenant-create');
      // A 409 is always the slug; put it on the field rather than only in a toast.
      setServerErrors(Object.keys(fields).length ? fields : { slug: msg });
      toast({ kind: 'danger', title: 'สร้างบริษัทไม่สำเร็จ', msg });
    }
  });

  return (
    <Section
      title="ขั้นที่ 1 — บริษัทลูกค้า"
      description="ชื่อและ slug บังคับ ที่เหลือเว้นว่างได้"
    >
      <Note tone="info">
        ข้อมูลบิล (ชื่อจดทะเบียน เลขผู้เสียภาษี อีเมล ที่อยู่) กรอกได้เฉพาะตอนสร้างเท่านั้น
        เฟสนี้ยังไม่มี endpoint แก้ไข ถ้าพิมพ์ผิดต้องให้ทีมหลังบ้านแก้ที่ฐานข้อมูล
      </Note>

      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <TextField
          label="ชื่อบริษัท"
          required
          placeholder="เช่น Acme Cafe Co"
          error={serverErrors.name ?? errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="slug"
          required
          hint="a–z ตัวเล็ก ตัวเลข และขีดกลาง 2–60 ตัวอักษร ใช้อ้างอิงลูกค้ารายนี้"
          placeholder="acme-cafe"
          error={serverErrors.slug ?? errors.slug?.message}
          {...register('slug')}
        />
        <TextField
          label="ชื่อจดทะเบียน"
          placeholder="บริษัท เอกมี่ จำกัด"
          error={serverErrors.legal_name ?? errors.legal_name?.message}
          {...register('legal_name')}
        />
        <TextField
          label="เลขประจำตัวผู้เสียภาษี"
          inputMode="numeric"
          placeholder="0105561000000"
          error={serverErrors.tax_id ?? errors.tax_id?.message}
          {...register('tax_id')}
        />
        <TextField
          label="อีเมลสำหรับวางบิล"
          type="email"
          placeholder="billing@acme.co.th"
          error={serverErrors.billing_email ?? errors.billing_email?.message}
          {...register('billing_email')}
        />
        <TextField
          label="ที่อยู่สำหรับวางบิล"
          error={serverErrors.billing_address ?? errors.billing_address?.message}
          {...register('billing_address')}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
          <Button type="submit" variant="primary" loading={create.isPending}>
            สร้างบริษัท แล้วไปต่อ
          </Button>
        </div>
      </form>
    </Section>
  );
}

/* ----------------------------------------------------------------- step 2 -- */

function PackageStep({ tenant, onDone }: { tenant: TenantRead; onDone: (t: TenantRead) => void }) {
  const { data: packages, isLoading } = usePackages();
  const assign = useAssignPackage(tenant.id);
  const toast = useToast();
  const [key, setKey] = useState('');

  const options = (packages ?? []).map((p) => ({
    value: p.key,
    label: `${p.key} — ${p.name_th}`,
    disabled: !p.is_active,
    note: p.is_active
      ? `${formatBaht(p.price_monthly)}/เดือน · ${p.feature_keys.length} ฟีเจอร์`
      : 'เลิกขายแล้ว — กำหนดให้ลูกค้ารายใหม่ไม่ได้',
  }));

  const submit = async () => {
    if (!key) return;
    try {
      const t = await assign.mutateAsync(key);
      onDone(t);
    } catch (err) {
      toast({ kind: 'danger', title: 'กำหนดแพ็กเกจไม่สำเร็จ', msg: errorMessage(err, 'assign-package') });
    }
  };

  return (
    <Section
      title="ขั้นที่ 2 — แพ็กเกจ"
      description={`เลือกแพ็กเกจให้ ${tenant.name} — แพ็กเกจคือสิ่งที่เปิดฟีเจอร์ให้ทุกสาขาของลูกค้ารายนี้`}
    >
      <Note tone="info">
        กำหนดแพ็กเกจ<strong>ก่อน</strong>สร้างสาขา สาขาที่สร้างหลังจากนี้จะได้สิทธิ์ที่ถูกต้องตั้งแต่แรก
        และเจ้าของร้านเข้า POS ได้ครบทันที
      </Note>

      <Field label="แพ็กเกจ" hint="แพ็กเกจที่เลิกขายแล้วจะเลือกไม่ได้ แต่ลูกค้าเดิมที่ถืออยู่ยังใช้ต่อได้ตามปกติ">
        {({ id, describedBy }) => (
          <Select
            id={id}
            describedBy={describedBy}
            ariaLabel="แพ็กเกจ"
            value={key}
            onChange={setKey}
            options={options}
            placeholder={isLoading ? 'กำลังโหลดแพ็กเกจ…' : '— เลือกแพ็กเกจ —'}
            disabled={isLoading}
          />
        )}
      </Field>

      {!isLoading && options.length === 0 && (
        <Note tone="warning">
          ยังไม่มีแพ็กเกจในระบบ — <Link href="/packages" className="row-link">สร้างแพ็กเกจก่อน</Link>{' '}
          หรือข้ามไปสร้างสาขาแล้วค่อยกลับมากำหนดทีหลัง
        </Note>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <Button variant="ghost" onClick={() => onDone(tenant)} disabled={assign.isPending}>
          ข้ามไปก่อน
        </Button>
        <Button variant="primary" onClick={submit} loading={assign.isPending} disabled={!key}>
          กำหนดแพ็กเกจ แล้วไปต่อ
        </Button>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- step 3 -- */

function StoreStep({ tenant, onFinish }: { tenant: TenantRead; onFinish: () => void }) {
  const createStore = useCreateStore(tenant.id);
  const toast = useToast();
  const [slugError, setSlugError] = useState<string | undefined>();
  // The PIN lives here and nowhere else — never in localStorage, never in the
  // query cache. Leaving this screen destroys it for good.
  const [created, setCreated] = useState<StoreCreatedResponse | null>(null);

  const submit = async (values: StoreCreateForm) => {
    setSlugError(undefined);
    try {
      const res = await createStore.mutateAsync(values);
      setCreated(res);
    } catch (err) {
      const msg = errorMessage(err, 'store-create');
      const fields = fieldErrors(err);
      setSlugError(fields.slug ?? msg);
      toast({ kind: 'danger', title: 'สร้างสาขาไม่สำเร็จ', msg });
    }
  };

  if (created) {
    return (
      <Section title="ขั้นที่ 3 — สาขาแรกสร้างแล้ว" description={`สร้าง ${created.name} ให้ ${tenant.name} เรียบร้อย`}>
        <PinReveal
          storeName={created.name}
          storeSlug={created.slug}
          pin={created.owner_pin}
          storeIsActive={created.is_active}
          onDone={onFinish}
          doneLabel="เสร็จสิ้น ไปหน้าลูกค้า"
        />
      </Section>
    );
  }

  return (
    <Section
      title="ขั้นที่ 3 — สาขาแรก"
      description={<>สร้างสาขาให้ {tenant.name} (<Mono>{tenant.slug}</Mono>) พร้อมผู้ใช้ระดับเจ้าของร้าน</>}
    >
      <StoreForm
        tenantSlug={tenant.slug}
        tenantIsActive={tenant.is_active}
        submitting={createStore.isPending}
        slugError={slugError}
        onSubmit={submit}
        submitLabel="สร้างสาขา"
        footerExtra={
          <Button variant="ghost" onClick={onFinish} disabled={createStore.isPending}>
            ยังไม่สร้างสาขาตอนนี้
          </Button>
        }
      />
    </Section>
  );
}
