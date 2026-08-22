'use client';

import { useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/error-copy';
import { formatDateTime } from '@/lib/format';
import type { TenantRead } from '@/hooks/use-tenants';
import {
  useCreateStore, useResumeStore, useStores, useSuspendStore,
  type StoreCreatedResponse, type StoreRead,
} from '@/hooks/use-stores';
import type { StoreCreateForm } from '@/lib/schemas';
import { DataTable, type Column } from './ui/data-table';
import { Section, Note, Mono } from './ui/layout-bits';
import { Tag, FeatureChip } from './ui/tag';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { ConfirmDialog } from './ui/confirm-dialog';
import { PinReveal, StoreForm } from './store-create';
import { useToast } from './ui/toast';

type PendingStoreAction = { kind: 'suspend' | 'resume'; store: StoreRead } | null;

export function TenantStores({ tenant }: { tenant: TenantRead }) {
  const { data, isLoading, isError, error, refetch } = useStores(tenant.id);
  const suspendStore = useSuspendStore(tenant.id);
  const resumeStore = useResumeStore(tenant.id);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [action, setAction] = useState<PendingStoreAction>(null);

  const stores = data ?? [];
  const suspendedCount = stores.filter((s) => !s.is_active).length;

  const columns: Column<StoreRead>[] = [
    {
      key: 'name',
      header: 'สาขา',
      render: (s) => (
        <>
          <span style={{ fontWeight: 'var(--fw-semibold)' }}>{s.name}</span>
          <div><Mono>{s.slug}</Mono></div>
        </>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      render: (s) =>
        s.is_active ? (
          <Tag tone="success">ใช้งานปกติ</Tag>
        ) : (
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
            <Tag tone="warning">อ่านอย่างเดียว</Tag>
            {s.suspended_at && (
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)' }}>
                ตั้งแต่ {formatDateTime(s.suspended_at)}
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'features',
      header: 'ฟีเจอร์ที่เปิด',
      render: (s) =>
        s.features.length === 0 ? (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-12)' }}>ไม่มี</span>
        ) : (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {s.features.map((f) => <FeatureChip key={f}>{f}</FeatureChip>)}
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'จัดการ',
      width: '190px',
      render: (s) =>
        s.is_active ? (
          <Button variant="ghost" size="sm" onClick={() => setAction({ kind: 'suspend', store: s })}>
            สลับเป็นอ่านอย่างเดียว
          </Button>
        ) : (
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!tenant.is_active}
              onClick={() => setAction({ kind: 'resume', store: s })}
            >
              เปิดใช้งานสาขา
            </Button>
            {!tenant.is_active && (
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)', maxWidth: 170, lineHeight: 1.45 }}>
                ต้องเปิดใช้งานบริษัทก่อน
              </span>
            )}
          </span>
        ),
    },
  ];

  const runAction = async (reason: string) => {
    if (!action) return;
    const { kind, store } = action;
    try {
      if (kind === 'suspend') {
        await suspendStore.mutateAsync({ storeId: store.id, reason });
        toast({ kind: 'success', title: `${store.name} เป็นโหมดอ่านอย่างเดียวแล้ว` });
      } else {
        await resumeStore.mutateAsync({ storeId: store.id, reason });
        toast({ kind: 'success', title: `${store.name} กลับมาใช้งานได้แล้ว` });
      }
      setAction(null);
    } catch (err) {
      toast({
        kind: 'danger',
        title: kind === 'suspend' ? 'พักสาขาไม่สำเร็จ' : 'เปิดสาขาไม่สำเร็จ',
        msg: errorMessage(err, kind === 'resume' ? 'store-resume' : 'generic'),
      });
    }
  };

  return (
    <Section
      title="สาขา"
      description={
        stores.length > 0 && suspendedCount > 0
          ? `${stores.length} สาขา — ${suspendedCount} สาขาอยู่ในโหมดอ่านอย่างเดียว`
          : 'ฟีเจอร์ของแต่ละสาขาคำนวณจากแพ็กเกจของลูกค้า แก้รายสาขาไม่ได้'
      }
      actions={
        <Button variant="ghost" icon="plus" onClick={() => setAddOpen(true)}>
          เพิ่มสาขา
        </Button>
      }
    >
      <DataTable
        caption={`สาขาของ ${tenant.name}`}
        columns={columns}
        rows={stores}
        rowKey={(s) => s.id}
        loading={isLoading}
        error={isError ? errorMessage(error) : null}
        onRetry={() => refetch()}
        empty={{
          icon: 'store',
          title: 'ยังไม่มีสาขา',
          body: 'สร้างสาขาแรกให้ลูกค้ารายนี้ ระบบจะสร้างผู้ใช้ระดับเจ้าของร้านพร้อม PIN ให้ด้วย',
          action: (
            <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
              เพิ่มสาขา
            </Button>
          ),
        }}
      />

      {addOpen && (
        <AddStoreModal tenant={tenant} onClose={() => setAddOpen(false)} />
      )}

      {action?.kind === 'suspend' && (
        <ConfirmDialog
          title={`สลับ ${action.store.name} เป็นโหมดอ่านอย่างเดียว`}
          tone="danger"
          confirmLabel="สลับเป็นอ่านอย่างเดียว"
          busy={suspendStore.isPending}
          onClose={() => setAction(null)}
          onConfirm={runAction}
          reason={{
            label: 'เหตุผล',
            required: true,
            placeholder: 'เช่น ปิดปรับปรุงร้าน 1–15 ก.ย.',
            hint: 'เหตุผลถูกบันทึกลง audit log และใช้อ้างอิงตอนกลับมาเปิดใหม่',
          }}
          body={
            <>
              พนักงานสาขานี้ยัง<strong>เข้า POS ได้ปกติ</strong> ดูประวัติการขาย ออกรายงาน และ export ได้
              แต่จะสร้างออเดอร์หรือแก้ข้อมูลไม่ได้ สาขาอื่นของลูกค้ารายนี้ไม่ได้รับผลกระทบ
            </>
          }
        />
      )}

      {action?.kind === 'resume' && (
        <ConfirmDialog
          title={`เปิดใช้งาน ${action.store.name}`}
          confirmLabel="เปิดใช้งานสาขา"
          busy={resumeStore.isPending}
          onClose={() => setAction(null)}
          onConfirm={runAction}
          reason={{ label: 'เหตุผล (ไม่บังคับ)', required: false, placeholder: 'เช่น เปิดร้านใหม่แล้ว' }}
          body="สาขานี้จะกลับมาสร้างออเดอร์และแก้ข้อมูลได้ตามปกติ"
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- add store -- */

function AddStoreModal({ tenant, onClose }: { tenant: TenantRead; onClose: () => void }) {
  const createStore = useCreateStore(tenant.id);
  const toast = useToast();
  const [slugError, setSlugError] = useState<string | undefined>();
  // Held in this component only. Closing the modal destroys the PIN for good,
  // which is why the modal refuses to close while it is on screen.
  const [created, setCreated] = useState<StoreCreatedResponse | null>(null);

  const submit = async (values: StoreCreateForm) => {
    setSlugError(undefined);
    try {
      const res = await createStore.mutateAsync(values);
      setCreated(res);
    } catch (err) {
      const msg = errorMessage(err, 'store-create');
      setSlugError(fieldErrors(err).slug ?? msg);
      toast({ kind: 'danger', title: 'สร้างสาขาไม่สำเร็จ', msg });
    }
  };

  return (
    <Modal
      title={created ? 'PIN เจ้าของร้าน' : `เพิ่มสาขาให้ ${tenant.name}`}
      onClose={onClose}
      busy={createStore.isPending}
      // While the PIN is showing, Esc and the backdrop must not throw it away.
      dismissible={!created}
      width={created ? 460 : 560}
    >
      {created ? (
        <PinReveal
          storeName={created.name}
          storeSlug={created.slug}
          pin={created.owner_pin}
          storeIsActive={created.is_active}
          onDone={onClose}
        />
      ) : (
        <>
          {!tenant.package_key && (
            <Note tone="warning">
              ลูกค้ารายนี้ยังไม่มีแพ็กเกจ สาขาที่สร้างจะยังไม่มีฟีเจอร์ใด ๆ จนกว่าจะกำหนดแพ็กเกจให้
            </Note>
          )}
          <div style={{ marginTop: tenant.package_key ? 0 : 'var(--space-4)' }}>
            <StoreForm
              tenantSlug={tenant.slug}
              tenantIsActive={tenant.is_active}
              submitting={createStore.isPending}
              slugError={slugError}
              onSubmit={submit}
              footerExtra={
                <Button variant="ghost" onClick={onClose} disabled={createStore.isPending}>ยกเลิก</Button>
              }
            />
          </div>
        </>
      )}
    </Modal>
  );
}
