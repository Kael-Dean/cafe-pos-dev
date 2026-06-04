'use client';

import { useState, useMemo, useEffect } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht, NumberInput } from '../app-common';
import { useAllProducts, type MenuItem } from '@/hooks/use-products';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import { useProductDetail } from '@/hooks/use-bom';
import {
  useProductionOrders,
  useCreateProductionOrder,
  type ProductionOrder,
} from '@/hooks/use-production-orders';

const fmtDateTh = (str: string) =>
  new Date(str).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

export default function Bakery() {
  const toast = useToast();
  const { data: products, isLoading: productsLoading } = useAllProducts();
  const { data: inventoryItems } = useInventory();

  const producedProducts = useMemo(
    () => (products ?? []).filter(p => p.productType === 'PRODUCED'),
    [products],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const selectedProduct = producedProducts.find(p => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && producedProducts[0]) {
      setSelectedId(producedProducts[0].id);
    }
  }, [producedProducts, selectedId]);

  const filtered = producedProducts.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)' }}>
      {/* LEFT — produced product list */}
      <div style={{ width: 320, flexShrink: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--color-border)', background: 'linear-gradient(180deg, var(--color-accent-50) 0%, var(--color-surface) 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--color-accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="cake" size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Bakery / Production</div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>โรงผลิตเบเกอรี่</h2>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>บันทึกการผลิตล่วงหน้า · หักวัตถุดิบอัตโนมัติ · จัดการสต็อกสำเร็จรูป</div>
        </div>
        <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={16} color="var(--color-text-muted)" />
          </div>
          <input type="text" placeholder="ค้นหารายการผลิต..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {productsLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              <div style={{ marginBottom: 6 }}>ยังไม่มีเมนูประเภท "ผลิตล่วงหน้า"</div>
              <div style={{ fontSize: 11 }}>สร้างเมนูที่ BOM Builder แล้วเลือกวิธีผลิต "ผลิตล่วงหน้า"</div>
            </div>
          ) : filtered.map(p => {
            const isActive = p.id === selectedId;
            const stockItem = inventoryItems?.find(i => i.id === p.finishedGoodsItemId);
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)} style={{
                display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 10, marginBottom: 2, borderRadius: 8,
                background: isActive ? 'var(--color-accent-50)' : 'transparent',
                border: isActive ? '1px solid var(--color-accent)' : '1px solid transparent',
                cursor: 'pointer', textAlign: 'left', transition: 'all 150ms var(--ease-out)',
              }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{p.tag}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{baht(p.price)}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>·</span>
                    <span className="num" style={{ fontSize: 11, color: stockItem && stockItem.stock > 0 ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 600 }}>
                      {stockItem ? `${stockItem.stock.toLocaleString()} ${stockItem.unit}` : '—'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT — selected product detail */}
      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {!selectedProduct ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>เลือกรายการเพื่อบันทึกการผลิต</div>
        ) : (
          <ProductionPanel
            product={selectedProduct}
            stockItem={inventoryItems?.find(i => i.id === selectedProduct.finishedGoodsItemId) ?? null}
            onSuccess={(units) => toast({ kind: 'success', title: 'บันทึกการผลิตแล้ว', msg: `+${units} ${selectedProduct.name}` })}
            onError={(msg) => toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg })}
          />
        )}
      </div>
    </div>
  );
}

interface ProductionPanelProps {
  product: MenuItem;
  stockItem: InventoryItem | null;
  onSuccess: (units: number) => void;
  onError: (msg: string) => void;
}

const ProductionPanel = ({ product, stockItem, onSuccess, onError }: ProductionPanelProps) => {
  const { data: detail } = useProductDetail(product.id);
  const { data: history } = useProductionOrders({ productId: product.id });
  const createOrder = useCreateProductionOrder();

  const [batches, setBatches] = useState(1);
  const [notes, setNotes] = useState('');

  const recipeIncomplete = !detail || detail.recipe.length === 0;
  const unitsPreview = batches * Math.max(1, product.servingsPerBatch);

  const submit = async () => {
    if (batches < 1) return;
    try {
      const result = await createOrder.mutateAsync({
        product_id: product.id,
        batches_count: batches,
        notes: notes.trim() || null,
      });
      onSuccess(result.units_produced);
      setBatches(1);
      setNotes('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'กรุณาลองใหม่');
    }
  };

  return (
    <>
      {/* Header */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 80, height: 80, borderRadius: 12, background: product.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800, flexShrink: 0 }}>{product.tag}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{product.nameEn}</div>
          <h1 style={{ margin: '2px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{product.name}</h1>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Tag tone="accent">ผลิตล่วงหน้า</Tag>
            <Tag tone="info">{product.servingsPerBatch} ชิ้น/แบทช์</Tag>
            <Tag tone={recipeIncomplete ? 'warning' : 'success'}>
              {recipeIncomplete ? 'ยังไม่มีสูตร' : `${detail?.recipe.length} วัตถุดิบ`}
            </Tag>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>สต็อกพร้อมขาย</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: stockItem && stockItem.stock > 0 ? 'var(--color-text)' : 'var(--color-warning)' }}>
            {stockItem ? stockItem.stock.toLocaleString() : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{stockItem?.unit ?? 'ชิ้น'}</div>
        </div>
      </div>

      {/* Production form */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>บันทึกการผลิต</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>หักวัตถุดิบจากสูตร · เพิ่มสต็อกสำเร็จรูป</div>
        </div>
        <div style={{ padding: 20 }}>
          {recipeIncomplete && (
            <div style={{ padding: 12, marginBottom: 16, background: 'var(--color-warning-50)', border: '1px solid var(--color-warning)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="info" size={18} color="var(--color-warning)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#9C6A1F', marginBottom: 2 }}>เมนูนี้ยังไม่มีสูตร</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  สามารถบันทึกการผลิตได้ แต่จะไม่หักวัตถุดิบ เพิ่มเฉพาะสต็อกสำเร็จรูป — แนะนำเพิ่มสูตรที่ BOM Builder ก่อน
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>จำนวนแบทช์ *</div>
              <NumberInput
                min={1}
                step={1}
                integer
                value={batches}
                onChange={setBatches}
                className="num"
                style={{ width: '100%', fontSize: 30, fontWeight: 700, textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 12px', outline: 'none', fontFamily: 'inherit', background: 'var(--color-surface)', letterSpacing: '-0.02em' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
              />
            </div>
            <div style={{ padding: '12px 16px', background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>จะผลิตได้</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary-700)', letterSpacing: '-0.02em' }}>{unitsPreview.toLocaleString()}</span>
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{stockItem?.unit ?? 'ชิ้น'}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>({batches} × {product.servingsPerBatch})</span>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>หมายเหตุ</div>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={500}
              placeholder="เช่น รอบเช้า, ทดลองสูตรใหม่"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: 'var(--color-surface)' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={submit}
              disabled={createOrder.isPending || batches < 1}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 24px', fontSize: 14, fontWeight: 600, background: createOrder.isPending ? 'var(--color-surface-2)' : 'var(--color-primary)', color: createOrder.isPending ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: createOrder.isPending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }}
              onMouseEnter={e => { if (!createOrder.isPending) e.currentTarget.style.background = 'var(--color-primary-700)'; }}
              onMouseLeave={e => { if (!createOrder.isPending) e.currentTarget.style.background = 'var(--color-primary)'; }}
            >
              <Icon name="check" size={16} />
              {createOrder.isPending ? 'กำลังบันทึก...' : 'บันทึกการผลิต'}
            </button>
          </div>
        </div>
      </div>

      {/* History */}
      <ProductionHistory orders={history ?? []} unit={stockItem?.unit ?? 'ชิ้น'} />
    </>
  );
};

const ProductionHistory = ({ orders, unit }: { orders: ProductionOrder[]; unit: string }) => (
  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>ประวัติการผลิต</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{orders.length} รายการ</div>
    </div>
    {orders.length === 0 ? (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีประวัติการผลิต</div>
    ) : (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 90px 110px 1fr', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
          <div>วันเวลา</div>
          <div style={{ textAlign: 'right' }}>แบทช์</div>
          <div style={{ textAlign: 'right' }}>ผลิตได้</div>
          <div>หมายเหตุ</div>
        </div>
        {orders.map(o => (
          <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '160px 90px 110px 1fr', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
            <div style={{ color: 'var(--color-text-secondary)' }}>{fmtDateTh(o.producedAt)}</div>
            <div className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{o.batchesCount}</div>
            <div className="num" style={{ textAlign: 'right', fontWeight: 700 }}>+{o.unitsProduced} {unit}</div>
            <div style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.notes ?? '—'}</div>
          </div>
        ))}
      </>
    )}
  </div>
);
