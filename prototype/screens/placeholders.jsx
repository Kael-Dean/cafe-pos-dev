// Placeholder screens for P1 features (Inventory, Customers, Reports, Settings)
// These show "Coming soon" with a preview of the planned layout

const PlaceholderScreen = ({ title, subtitle, icon, sections, accent }) => (
  <div className="scroll" style={{height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)'}}>
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20}}>
      <div>
        <div style={{fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2}}>P1 — Important</div>
        <h1 style={{margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}}>{title}</h1>
        {subtitle && <div style={{fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4}}>{subtitle}</div>}
      </div>
      <AppCommon.Tag tone="warning">Coming next</AppCommon.Tag>
    </div>

    {/* Skeleton-style preview of layout */}
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 32,
      display: 'flex', alignItems: 'center', gap: 24,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 12,
        background: accent || 'var(--color-accent-50)',
        color: 'var(--color-primary)',
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <Icon name={icon} size={32}/>
      </div>
      <div style={{flex: 1}}>
        <div style={{fontSize: 16, fontWeight: 700, marginBottom: 4}}>กำลังออกแบบ — {title}</div>
        <div style={{fontSize: 13, color: 'var(--color-text-secondary)'}}>
          หน้าจอนี้อยู่ใน priority P1 ตาม brief — จะสร้างหลังจาก P0 (POS, KDS, Dashboard) ผ่านการรีวิว
        </div>
      </div>
    </div>

    <div style={{marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16}}>
      {sections.map((s, i) => (
        <div key={i} style={{background: 'var(--color-surface)', border: '1px dashed var(--color-border-strong)', borderRadius: 12, padding: 20}}>
          <div style={{fontSize: 14, fontWeight: 600, marginBottom: 8}}>{s.title}</div>
          <div style={{fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6}}>{s.desc}</div>
          {/* Skeleton bars */}
          <div style={{marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8}}>
            {[0.95, 0.7, 0.85, 0.5].map((w, k) => (
              <div key={k} style={{height: 8, width: `${w * 100}%`, background: 'var(--color-surface-2)', borderRadius: 999}}/>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const Customers = () => (
  <PlaceholderScreen title="Customers / CRM" icon="customers"
    subtitle="สมาชิก • ประวัติซื้อ • โปรโมชัน"
    sections={[
      { title: 'รายการสมาชิก', desc: 'ตารางลูกค้า + filter (last visit, total spend, tier)' },
      { title: 'รายละเอียดลูกค้า', desc: 'ประวัติซื้อ เมนูโปรด แต้มสะสม tier' },
      { title: 'แคมเปญโปรโมชัน', desc: 'ส่งข้อความผ่าน LINE OA / SMS แบบกลุ่มเป้าหมาย' },
    ]}
  />
);

const Reports = () => (
  <PlaceholderScreen title="Reports" icon="reports"
    subtitle="Sales • Products • Customers • Staff • Inventory • Finance"
    sections={[
      { title: 'Sales Report', desc: 'ยอดขายแบ่งตามช่วงเวลา เปรียบเทียบ period vs period' },
      { title: 'Menu Engineering', desc: 'Scatter plot 4-quadrant: Stars / Plow Horses / Puzzles / Dogs พร้อม recommended actions' },
      { title: 'Staff Performance', desc: 'KPI per staff: sales/hour, ATV, void count, sales rank' },
      { title: 'Export', desc: 'PDF / Excel / CSV — schedule รายวัน รายสัปดาห์ส่งเข้า email' },
    ]}
  />
);

const Settings = () => (
  <PlaceholderScreen title="Settings" icon="settings"
    subtitle="ข้อมูลร้าน • อุปกรณ์ • Integration • Backup"
    sections={[
      { title: 'ข้อมูลร้าน', desc: 'สาขา ภาษี สกุลเงิน เลขผู้เสียภาษี โลโก้บนใบเสร็จ' },
      { title: 'อุปกรณ์', desc: 'เครื่องพิมพ์ใบเสร็จ EDC QR Generator ระบบ KDS หน้าจอลูกค้า' },
      { title: 'Integration', desc: 'LINE OA, ระบบสมาชิก, GrabFood/LINE MAN, Shopee Food, e-Tax invoice' },
      { title: 'Backup & Sync', desc: 'Auto-backup รายวัน, multi-store sync, offline mode' },
    ]}
  />
);

window.Customers = Customers;
window.Reports = Reports;
window.Settings = Settings;
