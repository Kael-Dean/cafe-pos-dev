'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@/lib/admin-api';
import { errorMessage, fieldErrors } from '@/lib/error-copy';
import { tenantUpdateSchema, type TenantUpdateForm } from '@/lib/schemas';
import { toTenantUpdatePayload, useUpdateTenant, type TenantRead } from '@/hooks/use-tenants';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Note, Mono } from '@/components/ui/layout-bits';
import { useToast } from '@/components/ui/toast';

/**
 * Edit a tenant's legal/billing details. The PATCH takes only what changed —
 * an omitted key means "leave it", an explicit null means "clear it" — so the
 * form diffs itself against the loaded tenant on every keystroke rather than
 * submitting all five fields.
 */
export function TenantEditModal({ tenant, onClose }: { tenant: TenantRead; onClose: () => void }) {
  const update = useUpdateTenant(tenant.id);
  const toast = useToast();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const { register, handleSubmit, watch, formState: { errors } } = useForm<TenantUpdateForm>({
    resolver: zodResolver(tenantUpdateSchema),
    defaultValues: {
      name: tenant.name,
      legal_name: tenant.legal_name ?? '',
      tax_id: tenant.tax_id ?? '',
      billing_email: tenant.billing_email ?? '',
      billing_address: tenant.billing_address ?? '',
    },
  });

  const draft = watch();
  const payload = useMemo(() => toTenantUpdatePayload(draft, tenant), [draft, tenant]);
  const dirty = Object.keys(payload).length > 0;

  const submit = handleSubmit(async () => {
    // An empty PATCH is a 422 ("No fields to update"). The save button is already
    // disabled when nothing changed; this closes the race.
    if (!dirty) {
      onClose();
      return;
    }
    setServerErrors({});
    try {
      await update.mutateAsync(payload);
      toast({ kind: 'success', title: 'บันทึกข้อมูลบริษัทแล้ว', msg: tenant.name });
      onClose();
    } catch (err) {
      const msg = errorMessage(err, 'tenant-update');
      const fields = fieldErrors(err);
      // `name: null` is a 409 today and becomes a 422 later — both mean the same
      // thing, so both land on the name field.
      const nameIssue = err instanceof ApiError && (err.status === 409 || /name/i.test(err.message));
      setServerErrors(
        Object.keys(fields).length ? fields : { [nameIssue ? 'name' : 'billing_email']: msg },
      );
      toast({ kind: 'danger', title: 'บันทึกข้อมูลบริษัทไม่สำเร็จ', msg });
    }
  });

  return (
    <Modal
      title={`แก้ไขข้อมูลบริษัท — ${tenant.name}`}
      onClose={onClose}
      busy={update.isPending}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit} loading={update.isPending} disabled={!dirty}>
            บันทึก
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Note tone="info">
          slug (<Mono>{tenant.slug}</Mono>) เป็นค่าถาวร แก้ไม่ได้ — และแพ็กเกจแก้ที่หัวข้อ &ldquo;แพ็กเกจ&rdquo; ด้านล่าง
        </Note>

        <TextField
          label="ชื่อลูกค้า"
          required
          error={serverErrors.name ?? errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="ชื่อจดทะเบียน"
          hint="ชื่อนิติบุคคลตามหนังสือรับรอง ใช้ออกใบกำกับภาษี"
          error={serverErrors.legal_name ?? errors.legal_name?.message}
          {...register('legal_name')}
        />
        <TextField
          label="เลขผู้เสียภาษี"
          inputMode="numeric"
          hint="เว้นว่างไว้แล้วมาเติมทีหลังได้"
          error={serverErrors.tax_id ?? errors.tax_id?.message}
          {...register('tax_id')}
        />
        <TextField
          label="อีเมลวางบิล"
          type="email"
          inputMode="email"
          error={serverErrors.billing_email ?? errors.billing_email?.message}
          {...register('billing_email')}
        />
        <TextField
          label="ที่อยู่วางบิล"
          error={serverErrors.billing_address ?? errors.billing_address?.message}
          {...register('billing_address')}
        />

        <p style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          ล้างช่องไหนไว้ว่าง ระบบจะลบค่าเดิมของช่องนั้นออก ช่องที่ไม่ได้แก้จะไม่ถูกส่งไป
        </p>
      </form>
    </Modal>
  );
}
