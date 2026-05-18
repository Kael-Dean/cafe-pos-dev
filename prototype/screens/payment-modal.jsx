// Payment modal — handles cash, card, QR PromptPay, LINE Pay
// QR shows the dynamic-amount QR feel using a procedural SVG pattern

const PaymentModal = ({ method, total, billNo, onClose, onPaid }) => {
  const [phase, setPhase] = useState('await'); // 'await' | 'paid'
  const [cashGiven, setCashGiven] = useState('');

  // Auto-payment simulation for QR after a few seconds
  useEffect(() => {
    if (method === 'qr' || method === 'line') {
      const t = setTimeout(() => { /* user clicks */ }, 12000);
      return () => clearTimeout(t);
    }
  }, [method]);

  const change = method === 'cash' && cashGiven ? Math.max(0, parseFloat(cashGiven) - total) : 0;
  const cashEnough = method === 'cash' ? parseFloat(cashGiven || 0) >= total : true;

  const titleMap = { cash: 'รับเงินสด', card: 'รูดบัตร', qr: 'QR PromptPay', line: 'LINE Pay' };

  const onConfirmPay = () => {
    setPhase('paid');
    setTimeout(() => onPaid(), 900);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{
        width: 'min(440px, 92vw)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12}}>
          <div style={{
            width: 40, height: 40, borderRadius: 8, background: 'var(--color-accent-50)',
            color: 'var(--color-primary)', display: 'grid', placeItems: 'center',
          }}>
            <Icon name={method === 'cash' ? 'cash' : method === 'card' ? 'card' : method === 'line' ? 'line' : 'qr'} size={20}/>
          </div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 16, fontWeight: 700}}>{titleMap[method]}</div>
            <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>บิล A0{billNo}</div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-2)'}
             onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        {/* Body */}
        <div style={{padding: 24}}>
          {phase === 'paid' ? (
            <SuccessView total={total} />
          ) : method === 'qr' ? (
            <QRView total={total} onSimulatePay={onConfirmPay} />
          ) : method === 'line' ? (
            <LineView total={total} onSimulatePay={onConfirmPay} />
          ) : method === 'card' ? (
            <CardView total={total} onSimulatePay={onConfirmPay} />
          ) : (
            <CashView total={total} cashGiven={cashGiven} setCashGiven={setCashGiven} change={change} />
          )}
        </div>

        {/* Footer */}
        {phase !== 'paid' && method === 'cash' && (
          <div style={{padding: '12px 24px 20px', display: 'flex', gap: 8}}>
            <button onClick={onClose} className="btn btn-ghost" style={{flex: 1}}>ยกเลิก</button>
            <button onClick={onConfirmPay} disabled={!cashEnough} className="btn btn-primary" style={{flex: 2, opacity: cashEnough ? 1 : 0.5}}>
              <Icon name="check" size={16}/> ยืนยันรับเงิน
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const QRView = ({ total, onSimulatePay }) => (
  <div style={{textAlign: 'center'}}>
    <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>ยอดที่ต้องชำระ</div>
    <div className="num" style={{fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-primary)', marginBottom: 4}}>
      ฿{total.toLocaleString()}
    </div>
    <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16}}>คาเฟ่ Kafé OS • PromptPay</div>

    <div style={{
      width: 240, height: 240, margin: '0 auto', padding: 16,
      background: 'white', borderRadius: 12, border: '1px solid var(--color-border)',
    }}>
      <FakeQR seed={total} />
    </div>

    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, fontSize: 13, color: 'var(--color-text-secondary)'}}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: 'var(--color-warning)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}/>
      <span>กำลังรอการชำระเงิน...</span>
    </div>

    <button onClick={onSimulatePay} className="btn btn-primary btn-block btn-lg" style={{marginTop: 20}}>
      <Icon name="check" size={16}/> จำลอง: ลูกค้าชำระแล้ว
    </button>
    <button className="btn btn-ghost btn-block" style={{marginTop: 8}}>
      <Icon name="print" size={14}/> พิมพ์ใบเสร็จ
    </button>
    <style>{`@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }`}</style>
  </div>
);

const FakeQR = ({ seed }) => {
  // Procedural QR-like pattern: 25x25 grid, deterministic from seed
  const N = 25;
  const cells = useMemo(() => {
    const arr = [];
    let s = (seed * 9301 + 49297) % 233280;
    for (let i = 0; i < N * N; i++) {
      s = (s * 9301 + 49297) % 233280;
      arr.push((s / 233280) > 0.52);
    }
    // Force three finder squares
    const setRect = (cx, cy) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const inside = x >= 1 && x <= 5 && y >= 1 && y <= 5;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        arr[(cy + y) * N + (cx + x)] = !inside || inner;
      }
    };
    setRect(0, 0); setRect(N - 7, 0); setRect(0, N - 7);
    return arr;
  }, [seed]);

  return (
    <svg viewBox={`0 0 ${N} ${N}`} width="100%" height="100%">
      {cells.map((on, i) => on && (
        <rect key={i} x={i % N} y={Math.floor(i / N)} width="1" height="1" fill="#1A1A1A"/>
      ))}
    </svg>
  );
};

const CashView = ({ total, cashGiven, setCashGiven, change }) => {
  const presets = [100, 200, 500, 1000];
  return (
    <div>
      <div style={{textAlign: 'center', marginBottom: 16}}>
        <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>ยอดที่ต้องรับ</div>
        <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)'}}>฿{total.toLocaleString()}</div>
      </div>

      <div style={{fontSize: 13, fontWeight: 600, marginBottom: 8}}>เงินที่รับมา</div>
      <input
        type="number" placeholder="0"
        value={cashGiven} onChange={(e) => setCashGiven(e.target.value)}
        className="num"
        style={{
          width: '100%', padding: '14px 16px',
          fontSize: 24, fontWeight: 700, textAlign: 'right',
          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          borderRadius: 8, outline: 'none',
        }}
      />
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8}}>
        {presets.map((p) => (
          <button key={p} onClick={() => setCashGiven(String(p))}
            className="num"
            style={{
              padding: 10, borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            }}
          >฿{p}</button>
        ))}
        <button onClick={() => setCashGiven(String(total))}
          style={{
            padding: 10, borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)', color: 'var(--color-primary-700)',
            gridColumn: 'span 4',
          }}
        >พอดี ฿{total.toLocaleString()}</button>
      </div>

      <div style={{
        marginTop: 16, padding: 14,
        background: 'var(--color-success-50)', borderRadius: 8,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{fontSize: 13, color: 'var(--color-success)', fontWeight: 600}}>เงินทอน</div>
        <div className="num" style={{fontSize: 22, fontWeight: 700, color: 'var(--color-success)'}}>฿{change.toLocaleString()}</div>
      </div>
    </div>
  );
};

const CardView = ({ total, onSimulatePay }) => (
  <div style={{textAlign: 'center'}}>
    <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>ยอดที่ต้องชำระ</div>
    <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 24}}>฿{total.toLocaleString()}</div>
    <div style={{
      padding: 32, background: 'var(--color-surface-2)', borderRadius: 12,
      border: '2px dashed var(--color-border-strong)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 60, height: 60, borderRadius: 999,
        background: 'var(--color-info-50)', color: 'var(--color-info)',
        display: 'grid', placeItems: 'center',
        animation: 'wiggle 1.4s ease-in-out infinite',
      }}>
        <Icon name="card" size={28}/>
      </div>
      <div style={{fontSize: 14, fontWeight: 600}}>กรุณาเสียบ / แตะบัตรที่เครื่อง EDC</div>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>เครื่อง EDC: SCB-A1 • พร้อมใช้งาน</div>
    </div>
    <button onClick={onSimulatePay} className="btn btn-primary btn-block btn-lg" style={{marginTop: 16}}>
      <Icon name="check" size={16}/> จำลอง: รูดสำเร็จ
    </button>
    <style>{`@keyframes wiggle { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }`}</style>
  </div>
);

const LineView = ({ total, onSimulatePay }) => (
  <div style={{textAlign: 'center'}}>
    <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>ยอดที่ต้องชำระ</div>
    <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 24}}>฿{total.toLocaleString()}</div>
    <div style={{
      width: 200, height: 200, margin: '0 auto', padding: 12,
      background: 'white', borderRadius: 12, border: '1px solid var(--color-border)',
    }}>
      <FakeQR seed={total + 7} />
    </div>
    <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 12}}>สแกนเพื่อชำระผ่าน LINE Pay</div>
    <button onClick={onSimulatePay} className="btn btn-primary btn-block btn-lg" style={{marginTop: 16}}>
      <Icon name="check" size={16}/> จำลอง: ชำระสำเร็จ
    </button>
  </div>
);

const SuccessView = ({ total }) => (
  <div style={{textAlign: 'center', padding: '20px 0'}}>
    <div style={{
      width: 72, height: 72, margin: '0 auto 16px', borderRadius: 999,
      background: 'var(--color-success-50)', color: 'var(--color-success)',
      display: 'grid', placeItems: 'center',
      animation: 'pop 360ms var(--ease-out)',
    }}>
      <Icon name="check" size={40} strokeWidth={2}/>
    </div>
    <div style={{fontSize: 20, fontWeight: 700, marginBottom: 4}}>ชำระเงินสำเร็จ</div>
    <div className="num" style={{fontSize: 32, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 8}}>฿{total.toLocaleString()}</div>
    <div style={{fontSize: 13, color: 'var(--color-text-secondary)'}}>กำลังพิมพ์ใบเสร็จ และส่งไปยังครัว...</div>
    <style>{`@keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }`}</style>
  </div>
);

window.PaymentModal = PaymentModal;
