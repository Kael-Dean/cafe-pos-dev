'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/error-copy';
import { formatBaht, formatDateTime } from '@/lib/format';
import {
  useAssignPackage, useResumeTenant, useSuspendTenant, useTenant, type TenantRead,
} from '@/hooks/use-tenants';
import { usePackages } from '@/hooks/use-packages';
import { PageHeader, Section, DetailRow, Note, Mono } from '@/components/ui/layout-bits';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SkeletonCard } from '@/components/ui/skeleton';
import { TenantStores } from '@/components/tenant-stores';
import { TenantEditModal } from '@/components/tenant-edit-modal';
import { useToast } from '@/components/ui/toast';
import Icon from '@/components/ui/icon';

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: tenant, isLoading, isError, error, refetch } = useTenant(id);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 860 }}>
        <SkeletonCard lines={2} label="กำลังโหลดข้อมูลลูกค้า" />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  if (isError || !tenant) {
    return (
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', maxWidth: 560 }} role="alert">
        <Icon name="warning" size={26} color="var(--color-danger-fg)" style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 'var(--space-3)', fontWeight: 'var(--fw-semibold)' }}>เปิดข้อมูลลูกค้าไม่ได้</p>
        <p style={{ marginTop: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--fs-13)' }}>
          {errorMessage(error)}
        </p>
        <div style={{ marginTop: 'var(--space-5)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
          <Button variant="ghost" onClick={() => refetch()}>ลองใหม่</Button>
          <Link href="/tenants" className="btn btn-ghost">กลับไปหน้ารายชื่อ</Link>
        </div>
      </div>
    );
  }

  return <TenantDetail tenant={tenant} />;
}

/* ------------------------------------------------------------------------- */

type TenantAction = 'suspend' | 'resume' | 'clear-package' | 'edit' | null;

function TenantDetail({ tenant }: { tenant: TenantRead }) {
  const toast = useToast();
  const suspend = useSuspendTenant(tenant.id);
  const resume = useResumeTenant(tenant.id);
  const assign = useAssignPackage(tenant.id);
  const [action, setAction] = useState<TenantAction>(null);

  const runSuspend = async (reason: string) => {
    try {
      await suspend.mutateAsync(reason);
      setAction(null);
      toast({ kind: 'success', title: `${tenant.name} เป็นโหมดอ่านอย่างเดียวแล้ว`, msg: 'มีผลกับทุกสาขา' });
    } catch (err) {
      toast({ kind: 'danger', title: 'พักลูกค้าไม่สำเร็จ', msg: errorMessage(err) });
    }
  };

  const runResume = async (reason: string) => {
    try {
      await resume.mutateAsync(reason);
      setAction(null);
      toast({
        kind: 'success',
        title: `${tenant.name} กลับมาใช้งานได้แล้ว`,
        msg: 'สาขาที่เคยสั่งพักแยกไว้ยังคงอยู่ในโหมดอ่านอย่างเดียว',
      });
    } catch (err) {
      toast({ kind: 'danger', title: 'เปิดใช้งานลูกค้าไม่สำเร็จ', msg: errorMessage(err) });
    }
  };

  const runClearPackage = async () => {
    try {
      await assign.mutateAsync(null);
      setAction(null);
      toast({ kind: 'success', title: 'ล้างแพ็กเกจแล้ว', msg: 'ทุกสาขาไม่มีฟีเจอร์ที่เปิดอยู่' });
    } catch (err) {
      toast({ kind: 'danger', title: 'ล้างแพ็กเกจไม่สำเร็จ', msg: errorMessage(err) });
    }
  };

  return (
    <>
      <PageHeader
        title={tenant.name}
        lede={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Mono>{tenant.slug}</Mono>
            {tenant.is_active ? <Tag tone="success">ใช้งานปกติ</Tag> : <Tag tone="warning">อ่านอย่างเดียว</Tag>}
            {tenant.package_key
              ? <Tag tone="accent">{tenant.package_key}</Tag>
              : <Tag tone="neutral">ยังไม่มีแพ็กเกจ</Tag>}
          </span>
        }
        actions={
          <>
            <Link href="/tenants" className="btn btn-ghost">
              <Icon name="chevronLeft" size={16} />
              รายชื่อลูกค้า
            </Link>
            {tenant.is_active ? (
              <Button variant="danger" icon="pause" onClick={() => setAction('suspend')}>
                สลับเป็นอ่านอย่างเดียว
              </Button>
            ) : (
              <Button variant="primary" icon="play" onClick={() => setAction('resume')}>
                เปิดใช้งานลูกค้า
              </Button>
            )}
          </>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 980 }}>
        {!tenant.is_active && (
          <Note tone="warning">
            <strong>ลูกค้ารายนี้อยู่ในโหมดอ่านอย่างเดียว</strong>
            {tenant.suspended_at && <> ตั้งแต่ {formatDateTime(tenant.suspended_at)}</>}
            {tenant.suspension_reason && <> — เหตุผล: {tenant.suspension_reason}</>}
            <br />
            พนักงานทุกสาขายังเข้า POS ดูรายงานและ export ได้ แต่สร้างออเดอร์หรือแก้ข้อมูลไม่ได้
          </Note>
        )}

        <Section
          title="ข้อมูลบริษัท"
          description="แก้ไขได้ทุกช่องยกเว้น slug — slug เป็นค่าถาวรเพราะผูกกับลิงก์และความไม่ซ้ำของระบบ"
          actions={
            <Button variant="ghost" icon="pencil" onClick={() => setAction('edit')}>แก้ไข</Button>
          }
        >
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <dl style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0 }}>
              <DetailRow label="ชื่อจดทะเบียน">{tenant.legal_name ?? <Muted>ไม่ได้ระบุ</Muted>}</DetailRow>
              <DetailRow label="เลขผู้เสียภาษี">
                {tenant.tax_id ? <span className="num">{tenant.tax_id}</span> : <Muted>ไม่ได้ระบุ</Muted>}
              </DetailRow>
              <DetailRow label="อีเมลวางบิล">{tenant.billing_email ?? <Muted>ไม่ได้ระบุ</Muted>}</DetailRow>
              <DetailRow label="ที่อยู่วางบิล">{tenant.billing_address ?? <Muted>ไม่ได้ระบุ</Muted>}</DetailRow>
              <DetailRow label="สาขาที่เปิดอยู่">
                <span className="num">{tenant.store_count}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-12)', marginInlineStart: 6 }}>
                  (นับเฉพาะสาขาที่ไม่ได้ถูกพัก)
                </span>
              </DetailRow>
            </dl>
          </div>
        </Section>

        <PackageSection
          tenant={tenant}
          busy={assign.isPending}
          onClear={() => setAction('clear-package')}
        />

        <TenantStores tenant={tenant} />
      </div>

      {action === 'edit' && (
        <TenantEditModal tenant={tenant} onClose={() => setAction(null)} />
      )}

      {action === 'suspend' && (
        <ConfirmDialog
          title={`สลับ ${tenant.name} เป็นโหมดอ่านอย่างเดียว`}
          tone="danger"
          confirmLabel="สลับเป็นอ่านอย่างเดียว"
          busy={suspend.isPending}
          onClose={() => setAction(null)}
          onConfirm={runSuspend}
          reason={{
            label: 'เหตุผล',
            required: true,
            placeholder: 'เช่น ค้างชำระ ใบแจ้งหนี้ INV-2026-0007 เกินกำหนด 21 วัน',
            hint: 'เหตุผลถูกบันทึกลง audit log — เขียนให้อ่านย้อนหลังแล้วเข้าใจ',
          }}
          body={
            <>
              มีผลกับ<strong>ทุกสาขา</strong>ของลูกค้ารายนี้ พนักงานยังเข้า POS ได้ ดูประวัติการขาย ออกรายงาน
              และ export ได้ตามปกติ แต่จะสร้างออเดอร์หรือแก้ข้อมูลไม่ได้ ({tenant.store_count} สาขาที่เปิดอยู่จะถูกพักทั้งหมด)
            </>
          }
        />
      )}

      {action === 'resume' && (
        <ConfirmDialog
          title={`เปิดใช้งาน ${tenant.name}`}
          confirmLabel="เปิดใช้งานลูกค้า"
          busy={resume.isPending}
          onClose={() => setAction(null)}
          onConfirm={runResume}
          reason={{ label: 'เหตุผล (ไม่บังคับ)', required: false, placeholder: 'เช่น ได้รับชำระเงินแล้ว' }}
          body={
            <>
              ระบบจะเปิดเฉพาะสาขาที่ถูกพักจาก<strong>การพักบริษัทครั้งนี้</strong>
              {' '}สาขาที่เคยสั่งพักแยกไว้เอง (เช่น ปิดปรับปรุง) จะยังอยู่ในโหมดอ่านอย่างเดียวตามเดิม
            </>
          }
        />
      )}

      {action === 'clear-package' && (
        <ConfirmDialog
          title="ล้างแพ็กเกจของลูกค้ารายนี้"
          tone="danger"
          confirmLabel="ล้างแพ็กเกจ"
          busy={assign.isPending}
          onClose={() => setAction(null)}
          onConfirm={runClearPackage}
          body={
            <>
              ฟีเจอร์ทั้งหมดจะถูกถอดออกจาก<strong>ทุกสาขา</strong>ทันที พนักงานจะเข้าถึงฟีเจอร์ที่เคยใช้ไม่ได้
              ตั้งแต่คำขอถัดไป กำหนดแพ็กเกจใหม่ทีหลังได้เสมอ
            </>
          }
        />
      )}
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--color-text-muted)' }}>{children}</span>;
}

/* --------------------------------------------------------------- package -- */

function PackageSection({
  tenant, busy, onClear,
}: { tenant: TenantRead; busy: boolean; onClear: () => void }) {
  const { data: packages, isLoading } = usePackages();
  const assign = useAssignPackage(tenant.id);
  const toast = useToast();
  const [draft, setDraft] = useState(tenant.package_key ?? '');

  const current = packages?.find((p) => p.key === tenant.package_key);
  const dirty = draft !== (tenant.package_key ?? '');

  const options = (packages ?? []).map((p) => ({
    value: p.key,
    label: `${p.key} — ${p.name_th}`,
    // A retired package can't be assigned to anyone new (409), but a tenant
    // already on it keeps working — so it stays selectable when it IS current.
    disabled: !p.is_active && p.key !== tenant.package_key,
    note: !p.is_active
      ? p.key === tenant.package_key
        ? 'เลิกขายแล้ว — ลูกค้ารายนี้ใช้ต่อได้'
        : 'เลิกขายแล้ว — กำหนดให้รายใหม่ไม่ได้'
      : `${formatBaht(p.price_monthly)}/เดือน · ${p.feature_keys.length} ฟีเจอร์`,
  }));

  const apply = async () => {
    if (!draft || !dirty) return;
    try {
      await assign.mutateAsync(draft);
      toast({ kind: 'success', title: 'เปลี่ยนแพ็กเกจแล้ว', msg: `ทุกสาขาได้สิทธิ์ของ ${draft}` });
    } catch (err) {
      setDraft(tenant.package_key ?? '');
      toast({ kind: 'danger', title: 'เปลี่ยนแพ็กเกจไม่สำเร็จ', msg: errorMessage(err, 'assign-package') });
    }
  };

  return (
    <Section
      title="แพ็กเกจ"
      description="แพ็กเกจกำหนดว่าลูกค้ารายนี้เปิดฟีเจอร์อะไรได้บ้าง มีผลกับทุกสาขาพร้อมกัน ไม่มีการตั้งรายสาขา"
    >
      <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {current && (
          <dl style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0 }}>
            <DetailRow label="แพ็กเกจปัจจุบัน">
              {current.name_th} <Mono>({current.key})</Mono>
              {!current.is_active && <span style={{ marginInlineStart: 8 }}><Tag tone="neutral">เลิกขายแล้ว</Tag></span>}
            </DetailRow>
            <DetailRow label="ราคา">
              <span className="num">{formatBaht(current.price_monthly)}</span> / เดือน ·{' '}
              <span className="num">{formatBaht(current.price_annual)}</span> / ปี
            </DetailRow>
            <DetailRow label="ฟีเจอร์">
              {current.feature_keys.length === 0
                ? <Muted>ไม่มี</Muted>
                : current.feature_keys.join(', ')}
            </DetailRow>
          </dl>
        )}

        {!current && !isLoading && (
          <Note tone="warning">
            ลูกค้ารายนี้ยังไม่มีแพ็กเกจ ทุกสาขาจึงไม่มีฟีเจอร์ใด ๆ เปิดอยู่
          </Note>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label
              htmlFor="tenant-package"
              style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}
            >
              เปลี่ยนแพ็กเกจ
            </label>
            <Select
              id="tenant-package"
              ariaLabel="เปลี่ยนแพ็กเกจ"
              value={draft}
              onChange={setDraft}
              options={options}
              placeholder={isLoading ? 'กำลังโหลดแพ็กเกจ…' : '— เลือกแพ็กเกจ —'}
              disabled={isLoading || busy || assign.isPending}
            />
          </div>
          <Button variant="primary" onClick={apply} loading={assign.isPending} disabled={!dirty || !draft}>
            บันทึกแพ็กเกจ
          </Button>
          {tenant.package_key && (
            <Button variant="ghost" onClick={onClear} disabled={busy || assign.isPending}>
              ล้างแพ็กเกจ
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}
