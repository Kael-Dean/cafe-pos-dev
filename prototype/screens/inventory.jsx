// Inventory — Raw materials, Receive Stock, Wastage Log
// 3 tabs: items / receive / wastage. In-memory state mirroring backend Prisma model.

const Inventory = () => {
  const toast = AppCommon.useToast();
  const [tab, setTab] = useState('items');
  const [inventory, setInventory] = useState(() => INVENTORY.map(x => ({ ...x })));
  const [movements, setMovements] = useState(() => [...STOCK_MOVEMENTS]);

  // table filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [wastageOpen, setWastageOpen] = useState(false);
  const [presetItemId, setPresetItemId] = useState(null);

  // ─── derived ───
  const items = useMemo(() => inventory.map(it => {
    const status = stockStatusOf(it);
    return { ...it, status };
  }), [inventory]);

  const counts = useMemo(() => ({
    total: items.length,
    low: items.filter(i => i.status.tone === 'warning').length,
    critical: items.filter(i => i.status.tone === 'danger').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    return items.filter(it => {
      if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter === 'critical' && it.status.tone !== 'danger') return false;
      if (statusFilter === 'low' && it.status.tone !== 'warning') return false;
      if (statusFilter === 'ok' && it.status.tone !== 'success') return false;
      return true;
    });
  }, [items, search, statusFilter]);

  const recentReceives = useMemo(
    () => movements.filter(m => m.type === 'RECEIVE').sort((a, b) => b.at - a.at),
    [movements]
  );
  const recentWastage = useMemo(
    () => movements.filter(m => m.type === 'WASTE').sort((a, b) => b.at - a.at),
    [movements]
  );

  const wastageThisMonth = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return recentWastage
      .filter(m => m.at >= cutoff)
      .reduce((s, m) => {
        const inv = inventory.find(i => i.id === m.invId);
        return s + (inv ? inv.costPerUnit * m.qty : 0);
      }, 0);
  }, [recentWastage, inventory]);

  // ─── mutations ───
  const submitReceive = ({ invId, qty, costPerUnit, supplier, note }) => {
    const id = `mv${Date.now()}`;
    setMovements(m => [
      { id, type: 'RECEIVE', invId, qty, costPerUnit, supplier, note, user: 'แพรว ส.', at: Date.now() },
      ...m,
    ]);
    setInventory(inv => inv.map(it => it.id === invId
      ? { ...it, stock: it.stock + qty, costPerUnit }
      : it
    ));
    setReceiveOpen(false);
    setPresetItemId(null);
    const inv = inventory.find(i => i.id === invId);
    toast({
      kind: 'success',
      title: 'รับเข้าสต็อกแล้ว',
      msg: `${inv?.name} +${qty.toLocaleString()} ${inv?.unit}`,
    });
  };

  const submitWastage = ({ invId, qty, reason, note }) => {
    const id = `mv${Date.now()}`;
    setMovements(m => [
      { id, type: 'WASTE', invId, qty, reason, note, user: 'แพรว ส.', at: Date.now() },
      ...m,
    ]);
    setInventory(inv => inv.map(it => it.id === invId
      ? { ...it, stock: it.stock - qty }
      : it
    ));
    setWastageOpen(false);
    setPresetItemId(null);
    const inv = inventory.find(i => i.id === invId);
    const reasonLabel = WASTAGE_REASONS.find(r => r.id === reason)?.label || reason;
    toast({
      kind: 'warning',
      title: 'บันทึก Wastage แล้ว',
      msg: `${inv?.name} -${qty.toLocaleString()} ${inv?.unit} • ${reasonLabel}`,
    });
  };

  const openReceive = (itemId) => {
    setPresetItemId(itemId || null);
    setReceiveOpen(true);
  };
  const openWastage = (itemId) => {
    setPresetItemId(itemId || null);
    setWastageOpen(true);
  };

  // ─── render ───
  return (
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
          P1 — Inventory
        </div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Inventory</h1>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          วัตถุดิบ · รับเข้า · บันทึก Wastage
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <AppCommon.KPICard label="วัตถุดิบทั้งหมด" value={counts.total} suffix=" รายการ" />
        <AppCommon.KPICard label="ใกล้หมด (Low)" value={counts.low} suffix=" รายการ" />
        <AppCommon.KPICard label="ต่ำกว่าครึ่ง par (Critical)" value={counts.critical} suffix=" รายการ" />
      </div>

      {/* Tab strip */}
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--color-surface-2)', borderRadius: 10,
        marginBottom: 16, width: 'fit-content',
      }}>
        {[
          { id: 'items',   label: 'วัตถุดิบ' },
          { id: 'receive', label: 'รับเข้าสต็อก' },
          { id: 'waste',   label: 'บันทึก Wastage' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 600,
              border: 'none', borderRadius: 8, cursor: 'pointer',
              background: tab === t.id ? 'var(--color-surface)' : 'transparent',
              color: tab === t.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              fontFamily: 'inherit',
              transition: 'all 150ms var(--ease-out)',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'items' && (
        <ItemsTab
          items={filteredItems} totalCount={items.length}
          search={search} setSearch={setSearch}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          onReceive={openReceive} onWaste={openWastage}
        />
      )}

      {tab === 'receive' && (
        <ReceiveTab
          items={inventory} movements={recentReceives}
          onAdd={() => openReceive(null)}
        />
      )}

      {tab === 'waste' && (
        <WastageTab
          items={inventory} movements={recentWastage}
          totalCost={wastageThisMonth}
          onAdd={() => openWastage(null)}
        />
      )}

      {receiveOpen && (
        <ReceiveStockModal
          items={inventory} presetItemId={presetItemId}
          onClose={() => { setReceiveOpen(false); setPresetItemId(null); }}
          onSubmit={submitReceive}
        />
      )}
      {wastageOpen && (
        <WastageModal
          items={inventory} presetItemId={presetItemId}
          onClose={() => { setWastageOpen(false); setPresetItemId(null); }}
          onSubmit={submitWastage}
        />
      )}
    </div>
  );
};

// ─── helpers ───
const stockStatusOf = (it) => {
  if (it.stock < it.parLevel * 0.5) return { tone: 'danger',  label: 'Critical' };
  if (it.stock < it.parLevel)        return { tone: 'warning', label: 'Low' };
  return { tone: 'success', label: 'OK' };
};

const formatRelative = (ts) => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม. ที่แล้ว`;
  const d = Math.floor(hr / 24);
  return `${d} วันที่แล้ว`;
};

// ═══════════════════════════════════════════════════════
// Tab 1: Raw Materials Table
// ═══════════════════════════════════════════════════════
const ItemsTab = ({ items, totalCount, search, setSearch, statusFilter, setStatusFilter, onReceive, onWaste }) => (
  <div style={{
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 12, overflow: 'hidden',
  }}>
    {/* Filter row */}
    <div style={{
      padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
          <Icon name="search" size={16} color="var(--color-text-muted)" />
        </div>
        <input type="text" placeholder="ค้นหาวัตถุดิบ..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px 10px 36px',
            border: '1px solid var(--color-border)', borderRadius: 8,
            fontSize: 14, fontFamily: 'inherit', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8 }}>
        {[
          { id: 'all',      label: 'ทั้งหมด' },
          { id: 'critical', label: 'Critical' },
          { id: 'low',      label: 'Low' },
          { id: 'ok',       label: 'OK' },
        ].map(s => (
          <button key={s.id} onClick={() => setStatusFilter(s.id)}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: statusFilter === s.id ? 'var(--color-surface)' : 'transparent',
              color: statusFilter === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
              fontFamily: 'inherit',
            }}
          >{s.label}</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {items.length}/{totalCount} รายการ
      </div>
    </div>

    {/* Table head */}
    <div style={{
      display: 'grid', gridTemplateColumns: '1.6fr 70px 110px 110px 100px 110px 110px 200px',
      gap: 12, padding: '10px 20px',
      fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      background: 'var(--color-surface-2)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div>วัตถุดิบ</div>
      <div>หน่วย</div>
      <div style={{ textAlign: 'right' }}>คงเหลือ</div>
      <div style={{ textAlign: 'right' }}>Par level</div>
      <div>สถานะ</div>
      <div style={{ textAlign: 'right' }}>ต้นทุน/หน่วย</div>
      <div style={{ textAlign: 'right' }}>มูลค่ารวม</div>
      <div></div>
    </div>

    {/* Rows */}
    {items.length === 0 ? (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        ไม่พบวัตถุดิบที่ตรงเงื่อนไข
      </div>
    ) : items.map((it, idx) => {
      const totalValue = it.stock * it.costPerUnit;
      const ratio = it.parLevel > 0 ? Math.min(100, (it.stock / it.parLevel) * 100) : 100;
      return (
        <div key={it.id} style={{
          display: 'grid', gridTemplateColumns: '1.6fr 70px 110px 110px 100px 110px 110px 200px',
          gap: 12, padding: '12px 20px', alignItems: 'center',
          borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--color-border)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{it.name}</div>
            {/* tiny progress bar */}
            <div style={{
              marginTop: 6, height: 4, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden',
              maxWidth: 220,
            }}>
              <div style={{
                height: '100%', width: `${ratio}%`,
                background: it.status.tone === 'danger' ? 'var(--color-danger)'
                  : it.status.tone === 'warning' ? 'var(--color-warning)'
                  : 'var(--color-success)',
                transition: 'width 200ms var(--ease-out)',
              }} />
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{it.unit}</div>
          <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
            {it.stock.toLocaleString()}
          </div>
          <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
            {it.parLevel.toLocaleString()}
          </div>
          <div>
            <AppCommon.Tag tone={it.status.tone}>{it.status.label}</AppCommon.Tag>
          </div>
          <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
            ฿{it.costPerUnit.toFixed(2)}
          </div>
          <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>
            {AppCommon.baht(totalValue)}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onReceive(it.id)}
              style={miniBtnStyle('primary')}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}
            >
              <Icon name="plus" size={12} /> รับเข้า
            </button>
            <button onClick={() => onWaste(it.id)}
              style={miniBtnStyle('ghost')}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <Icon name="trash" size={12} /> Waste
            </button>
          </div>
        </div>
      );
    })}
  </div>
);

const miniBtnStyle = (variant) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 10px', fontSize: 11, fontWeight: 600,
  border: variant === 'ghost' ? '1px solid var(--color-border)' : 'none',
  borderRadius: 6, cursor: 'pointer',
  background: variant === 'ghost' ? 'transparent' : 'var(--color-primary)',
  color: variant === 'ghost' ? 'var(--color-text-secondary)' : '#fff',
  fontFamily: 'inherit',
  transition: 'all 150ms var(--ease-out)',
});

// ═══════════════════════════════════════════════════════
// Tab 2: Receive Stock
// ═══════════════════════════════════════════════════════
const ReceiveTab = ({ items, movements, onAdd }) => (
  <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>ประวัติรับเข้าสต็อก</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {movements.length} รายการล่าสุด
        </div>
      </div>
      <button onClick={onAdd}
        style={primaryBtnStyle()}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}
      >
        <Icon name="plus" size={14} /> รับเข้าสต็อกใหม่
      </button>
    </div>

    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 110px 1fr 1fr',
        gap: 12, padding: '10px 20px',
        fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        background: 'var(--color-surface-2)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div>เวลา</div>
        <div>วัตถุดิบ</div>
        <div style={{ textAlign: 'right' }}>จำนวน</div>
        <div style={{ textAlign: 'right' }}>ต้นทุนรวม</div>
        <div>Supplier</div>
        <div>ผู้บันทึก / หมายเหตุ</div>
      </div>
      {movements.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          ยังไม่มีรายการรับเข้า
        </div>
      ) : movements.map((m, idx) => {
        const inv = items.find(i => i.id === m.invId);
        const totalCost = m.qty * m.costPerUnit;
        return (
          <div key={m.id} style={{
            display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 110px 1fr 1fr',
            gap: 12, padding: '12px 20px', alignItems: 'center',
            borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--color-border)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatRelative(m.at)}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{inv?.name || m.invId}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>
              +{m.qty.toLocaleString()} {inv?.unit}
            </div>
            <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
              {AppCommon.baht(totalCost)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{m.supplier || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <div>{m.user}</div>
              {m.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{m.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  </>
);

// ═══════════════════════════════════════════════════════
// Tab 3: Wastage
// ═══════════════════════════════════════════════════════
const WastageTab = ({ items, movements, totalCost, onAdd }) => (
  <>
    {/* Summary card */}
    <div style={{
      background: 'var(--color-warning-50)', border: '1px solid var(--color-warning)',
      borderRadius: 12, padding: 20, marginBottom: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'rgba(232,169,81,0.18)', color: '#9C6A1F',
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon name="warning" size={24} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9C6A1F', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            มูลค่าสูญเสียเดือนนี้
          </div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, color: '#9C6A1F', letterSpacing: '-0.02em', marginTop: 2 }}>
            {AppCommon.baht(totalCost)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            จาก {movements.filter(m => {
              const cutoff = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
              return m.at >= cutoff;
            }).length} รายการ
          </div>
        </div>
      </div>
      <button onClick={onAdd}
        style={primaryBtnStyle()}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}
      >
        <Icon name="plus" size={14} /> บันทึก Wastage
      </button>
    </div>

    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 130px 110px 1fr',
        gap: 12, padding: '10px 20px',
        fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        background: 'var(--color-surface-2)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div>เวลา</div>
        <div>วัตถุดิบ</div>
        <div style={{ textAlign: 'right' }}>จำนวน</div>
        <div>สาเหตุ</div>
        <div style={{ textAlign: 'right' }}>มูลค่า</div>
        <div>ผู้บันทึก / หมายเหตุ</div>
      </div>
      {movements.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          ยังไม่มีบันทึก Wastage
        </div>
      ) : movements.map((m, idx) => {
        const inv = items.find(i => i.id === m.invId);
        const lossValue = inv ? inv.costPerUnit * m.qty : 0;
        const reason = WASTAGE_REASONS.find(r => r.id === m.reason);
        return (
          <div key={m.id} style={{
            display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 130px 110px 1fr',
            gap: 12, padding: '12px 20px', alignItems: 'center',
            borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--color-border)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatRelative(m.at)}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{inv?.name || m.invId}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--color-danger)' }}>
              -{m.qty.toLocaleString()} {inv?.unit}
            </div>
            <div>
              <AppCommon.Tag tone={m.reason === 'EXPIRED' ? 'danger' : m.reason === 'TRIAL' ? 'info' : 'warning'}>
                {reason?.label || m.reason}
              </AppCommon.Tag>
            </div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>
              {AppCommon.baht(lossValue)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <div>{m.user}</div>
              {m.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{m.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  </>
);

const primaryBtnStyle = () => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 150ms var(--ease-out)',
});

// ═══════════════════════════════════════════════════════
// Modal: Receive Stock
// ═══════════════════════════════════════════════════════
const ReceiveStockModal = ({ items, presetItemId, onClose, onSubmit }) => {
  const [invId, setInvId] = useState(presetItemId || '');
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [costPerUnit, setCostPerUnit] = useState(() => {
    const it = items.find(i => i.id === presetItemId);
    return it ? String(it.costPerUnit) : '';
  });

  const selectedItem = items.find(i => i.id === invId);

  // sync cost when item changes
  const handleSelectItem = (id) => {
    setInvId(id);
    const it = items.find(i => i.id === id);
    if (it) setCostPerUnit(String(it.costPerUnit));
  };

  const canSubmit = invId && Number(qty) > 0 && Number(costPerUnit) >= 0;
  const totalCost = Number(qty) * Number(costPerUnit);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      invId,
      qty: Number(qty),
      costPerUnit: Number(costPerUnit),
      supplier: supplier.trim(),
      note: note.trim(),
    });
  };

  return (
    <ModalShell title="รับเข้าสต็อก" subtitle="เพิ่มจำนวนวัตถุดิบเข้าคลัง" onClose={onClose}>
      <FormField label="วัตถุดิบ">
        <ItemSelect items={items} value={invId} onChange={handleSelectItem} placeholder="เลือกวัตถุดิบ..." />
      </FormField>

      {selectedItem && (
        <div style={{
          padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 16,
          fontSize: 12, color: 'var(--color-text-secondary)',
        }}>
          <div>คงเหลือปัจจุบัน: <strong className="num">{selectedItem.stock.toLocaleString()} {selectedItem.unit}</strong></div>
          <div>Par level: <strong className="num">{selectedItem.parLevel.toLocaleString()} {selectedItem.unit}</strong></div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label={`จำนวนที่รับ${selectedItem ? ` (${selectedItem.unit})` : ''}`}>
          <input type="number" min={0} step={selectedItem?.unit === 'ใบ' || selectedItem?.unit === 'อัน' || selectedItem?.unit === 'ชิ้น' ? 1 : 1}
            value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
            style={inputStyle()}
          />
        </FormField>
        <FormField label="ต้นทุน/หน่วย (฿)">
          <input type="number" min={0} step={0.01}
            value={costPerUnit} onChange={e => setCostPerUnit(e.target.value)} placeholder="0.00"
            style={inputStyle()}
          />
        </FormField>
      </div>

      <FormField label="Supplier (ผู้จำหน่าย)">
        <input type="text" value={supplier} onChange={e => setSupplier(e.target.value)}
          placeholder="เช่น กาแฟดอยช้าง, CP Fresh Milk"
          style={inputStyle()}
        />
      </FormField>

      <FormField label="หมายเหตุ">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="ไม่บังคับ"
          style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }}
        />
      </FormField>

      {canSubmit && (
        <div style={{
          padding: 12, marginTop: 8, marginBottom: 16,
          background: 'var(--color-success-50)', borderRadius: 8,
          fontSize: 13, color: 'var(--color-success)', fontWeight: 600,
        }}>
          ต้นทุนรวม: <span className="num">{AppCommon.baht(totalCost)}</span>
        </div>
      )}

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit}
          style={{ ...primaryBtnStyle(), opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        >
          <Icon name="check" size={14} /> บันทึก
        </button>
      </ModalActions>
    </ModalShell>
  );
};

// ═══════════════════════════════════════════════════════
// Modal: Wastage
// ═══════════════════════════════════════════════════════
const WastageModal = ({ items, presetItemId, onClose, onSubmit }) => {
  const [invId, setInvId] = useState(presetItemId || '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('EXPIRED');
  const [note, setNote] = useState('');

  const selectedItem = items.find(i => i.id === invId);
  const canSubmit = invId && Number(qty) > 0;
  const lossValue = selectedItem ? selectedItem.costPerUnit * Number(qty) : 0;
  const willGoNegative = selectedItem && Number(qty) > selectedItem.stock;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      invId,
      qty: Number(qty),
      reason,
      note: note.trim(),
    });
  };

  return (
    <ModalShell title="บันทึก Wastage" subtitle="ลดสต็อกพร้อมระบุสาเหตุ" onClose={onClose}>
      <FormField label="วัตถุดิบ">
        <ItemSelect items={items} value={invId} onChange={setInvId} placeholder="เลือกวัตถุดิบ..." />
      </FormField>

      {selectedItem && (
        <div style={{
          padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 16,
          fontSize: 12, color: 'var(--color-text-secondary)',
        }}>
          คงเหลือ: <strong className="num">{selectedItem.stock.toLocaleString()} {selectedItem.unit}</strong> · ต้นทุน: ฿{selectedItem.costPerUnit.toFixed(2)}/{selectedItem.unit}
        </div>
      )}

      <FormField label={`จำนวนที่สูญเสีย${selectedItem ? ` (${selectedItem.unit})` : ''}`}>
        <input type="number" min={0} step={1}
          value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
          style={inputStyle()}
        />
        {willGoNegative && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 6, fontWeight: 600 }}>
            ⚠ จำนวนเกินสต็อกที่มี — ระบบจะบันทึกแต่สต็อกจะติดลบ
          </div>
        )}
      </FormField>

      <FormField label="สาเหตุ">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {WASTAGE_REASONS.map(r => (
            <button key={r.id} onClick={() => setReason(r.id)}
              style={{
                padding: '10px 12px', fontSize: 13, fontWeight: 600,
                border: reason === r.id ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)',
                borderRadius: 8, cursor: 'pointer',
                background: reason === r.id ? 'var(--color-accent-50)' : 'var(--color-surface)',
                color: reason === r.id ? 'var(--color-primary)' : 'var(--color-text)',
                fontFamily: 'inherit',
                transition: 'all 150ms var(--ease-out)',
              }}
            >{r.label}</button>
          ))}
        </div>
      </FormField>

      <FormField label="หมายเหตุ">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="ไม่บังคับ"
          style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }}
        />
      </FormField>

      {canSubmit && (
        <div style={{
          padding: 12, marginTop: 8, marginBottom: 16,
          background: 'var(--color-danger-50)', borderRadius: 8,
          fontSize: 13, color: 'var(--color-danger)', fontWeight: 600,
        }}>
          มูลค่าที่สูญเสีย: <span className="num">{AppCommon.baht(lossValue)}</span>
        </div>
      )}

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit}
          style={{ ...primaryBtnStyle(), opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        >
          <Icon name="check" size={14} /> บันทึก
        </button>
      </ModalActions>
    </ModalShell>
  );
};

// ═══════════════════════════════════════════════════════
// Reusable form bits
// ═══════════════════════════════════════════════════════
const ModalShell = ({ title, subtitle, onClose, children }) => (
  <div style={{
    position: 'fixed', inset: 0,
    background: 'rgba(26, 16, 8, 0.55)',
    display: 'grid', placeItems: 'center',
    zIndex: 100, padding: 20,
    animation: 'backdrop-in 200ms var(--ease-out)',
  }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{
      background: 'var(--color-surface)', borderRadius: 16,
      width: '100%', maxWidth: 520, maxHeight: '85vh',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      animation: 'modal-in 220ms var(--ease-out)',
    }}>
      <div style={{
        padding: 20, borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center',
        }}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="scroll" style={{ overflow: 'auto', padding: 20, flex: 1 }}>
        {children}
      </div>
    </div>
  </div>
);

const ModalActions = ({ children }) => (
  <div style={{
    display: 'flex', gap: 8, justifyContent: 'flex-end',
    paddingTop: 8, borderTop: '1px solid var(--color-border)', marginTop: 8,
  }}>
    {children}
  </div>
);

const FormField = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
      {label}
    </div>
    {children}
  </div>
);

const inputStyle = () => ({
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--color-border)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
  background: 'var(--color-surface)',
});

const ghostBtnStyle = () => ({
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer',
  fontFamily: 'inherit',
});

const ItemSelect = ({ items, value, onChange, placeholder }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ ...inputStyle(), appearance: 'auto' }}
  >
    <option value="" disabled>{placeholder}</option>
    {items.map(it => (
      <option key={it.id} value={it.id}>
        {it.name} · คงเหลือ {it.stock.toLocaleString()} {it.unit}
      </option>
    ))}
  </select>
);

window.Inventory = Inventory;
