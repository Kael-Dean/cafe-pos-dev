'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTenants, type TenantRead } from '@/hooks/use-tenants';
import { errorMessage } from '@/lib/error-copy';
import { DataTable, type Column } from '@/components/ui/data-table';
import { PageHeader, Mono } from '@/components/ui/layout-bits';
import { Tag } from '@/components/ui/tag';
import Icon from '@/components/ui/icon';

export default function TenantsPage() {
  const { data, isLoading, isError, error, refetch } = useTenants();
  const [q, setQ] = useState('');

  // No server-side search or pagination: the client count is small enough that
  // filtering the loaded list is both simpler and faster.
  const rows = useMemo(() => {
    const all = data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        (t.package_key ?? '').toLowerCase().includes(needle),
    );
  }, [data, q]);

  const columns: Column<TenantRead>[] = [
    {
      key: 'name',
      header: 'ลูกค้า',
      render: (t) => (
        <>
          <Link href={`/tenants/${t.id}`} className="row-link">{t.name}</Link>
          <div><Mono>{t.slug}</Mono></div>
        </>
      ),
    },
    {
      key: 'package',
      header: 'แพ็กเกจ',
      render: (t) =>
        t.package_key
          ? <Tag tone="accent">{t.package_key}</Tag>
          : <Tag tone="neutral">ยังไม่มีแพ็กเกจ</Tag>,
    },
    {
      key: 'status',
      header: 'สถานะ',
      render: (t) =>
        t.is_active
          ? <Tag tone="success">ใช้งานปกติ</Tag>
          : <Tag tone="warning">อ่านอย่างเดียว</Tag>,
    },
    {
      key: 'stores',
      header: 'สาขาที่เปิด',
      numeric: true,
      width: '110px',
      // store_count counts ACTIVE stores only — a client with a suspended
      // branch reports fewer than it has. The header says so.
      render: (t) => <span className="num">{t.store_count}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        lede="บริษัทที่ซื้อระบบ POS ของเรา หนึ่งรายอาจมีหลายสาขา"
        actions={
          <Link href="/tenants/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            เพิ่มลูกค้าใหม่
          </Link>
        }
      />

      <div style={{ position: 'relative', maxWidth: 340, marginBottom: 'var(--space-4)' }}>
        <Icon
          name="search"
          size={16}
          color="var(--color-text-muted)"
          style={{ position: 'absolute', insetInlineStart: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        />
        <input
          type="search"
          className="input-std"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อ, slug หรือแพ็กเกจ"
          aria-label="ค้นหาลูกค้า"
          style={{ paddingInlineStart: 34 }}
        />
      </div>

      <DataTable
        caption="รายชื่อลูกค้า"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={isLoading}
        error={isError ? errorMessage(error) : null}
        onRetry={() => refetch()}
        empty={
          q.trim()
            ? { icon: 'search', title: 'ไม่พบลูกค้าที่ตรงกับคำค้น', body: `ไม่มีรายการที่ตรงกับ “${q.trim()}” ลองค้นด้วยคำอื่น` }
            : {
                icon: 'building',
                title: 'ยังไม่มีลูกค้าในระบบ',
                body: 'เริ่มจากเพิ่มบริษัทลูกค้ารายแรก แล้วกำหนดแพ็กเกจและสร้างสาขาให้เขา',
                action: (
                  <Link href="/tenants/new" className="btn btn-primary">
                    <Icon name="plus" size={16} />
                    เพิ่มลูกค้าใหม่
                  </Link>
                ),
              }
        }
      />
    </>
  );
}
