'use client';

import { useState, useMemo } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useProtocols, useCreateProtocol, useTodayProtocolLogs, useLogProtocol, type Protocol } from '@/hooks/use-protocols';

const FREQ_LABEL: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'accent' }> = {
  DAILY:   { label: 'ทุกวัน',    tone: 'success' },
  OPENING: { label: 'เปิดร้าน',  tone: 'info' },
  CLOSING: { label: 'ปิดร้าน',  tone: 'warning' },
  WEEKLY:  { label: 'รายสัปดาห์', tone: 'accent' },
};

const todayStr = () => new Date().toISOString().split('T')[0];

export default function ProtocolsScreen() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: protocols, isLoading } = useProtocols();
  const { data: logs } = useTodayProtocolLogs();
  const createProtocol = useCreateProtocol();
  const logProtocol = useLogProtocol();

  const [tab, setTab] = useState<'checklist' | 'library'>('checklist');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', frequency: 'DAILY' });
  const [tasks, setTasks] = useState<string[]>(['']);

  // Map protocol_id → completed_task_ids for today
  const logMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    (logs ?? []).forEach(l => { m[l.protocol_id] = l.completed_task_ids; });
    return m;
  }, [logs]);

  const handleCheck = async (protocol: Protocol, taskId: string, checked: boolean) => {
    const current = logMap[protocol.id] ?? [];
    const next = checked ? [...current, taskId] : current.filter(id => id !== taskId);
    try {
      await logProtocol.mutateAsync({ protocol_id: protocol.id, log_date: todayStr(), completed_task_ids: next });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อ' }); return; }
    const validTasks = tasks.filter(t => t.trim());
    if (validTasks.length === 0) { toast({ kind: 'warning', title: 'เพิ่มอย่างน้อย 1 งาน' }); return; }
    try {
      await createProtocol.mutateAsync({
        name: form.name,
        description: form.description || undefined,
        frequency: form.frequency,
        tasks: validTasks.map((title, i) => ({ title, sort_order: i })),
      });
      toast({ kind: 'success', title: 'สร้าง Protocol แล้ว' });
      setShowForm(false);
      setForm({ name: '', description: '', frequency: 'DAILY' });
      setTasks(['']);
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const inputStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 } as React.CSSProperties;

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>Protocols / SOP</h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        {(['checklist', 'library'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 14, fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: tab === t ? 'var(--color-surface)' : 'transparent', borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {t === 'checklist' ? '✓ Checklist วันนี้' : '📋 คลัง Protocol'}
          </button>
        ))}
      </div>

      {tab === 'checklist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isLoading && <div style={{ color: 'var(--color-text-secondary)' }}>กำลังโหลด...</div>}
          {(protocols ?? []).length === 0 && !isLoading && (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>ยังไม่มี Protocol กดแท็บ &quot;คลัง&quot; เพื่อสร้าง</div>
          )}
          {(protocols ?? []).map(protocol => {
            const completed = logMap[protocol.id] ?? [];
            const pct = protocol.tasks.length > 0 ? Math.round((completed.length / protocol.tasks.length) * 100) : 0;
            const done = completed.length === protocol.tasks.length && protocol.tasks.length > 0;
            const freqInfo = FREQ_LABEL[protocol.frequency] ?? { label: protocol.frequency, tone: 'neutral' as const };
            return (
              <div key={protocol.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{protocol.name}</span>
                    <Tag tone={freqInfo.tone}>{freqInfo.label}</Tag>
                    {done && <Tag tone="success">✓ เสร็จแล้ว</Tag>}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{completed.length}/{protocol.tasks.length}</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: 'var(--color-surface-2)', borderRadius: 99, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: done ? 'var(--color-success)' : 'var(--color-accent)', borderRadius: 99, transition: 'width 300ms ease' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {protocol.tasks.map(task => {
                    const checked = completed.includes(task.id);
                    return (
                      <label key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 7, background: checked ? 'var(--color-success-50)' : 'transparent', transition: 'background 150ms' }}>
                        <input type="checkbox" checked={checked} onChange={e => handleCheck(protocol, task.id, e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--color-success)', cursor: 'pointer' }} />
                        <span style={{ fontSize: 14, color: checked ? 'var(--color-success)' : 'var(--color-text)', textDecoration: checked ? 'line-through' : 'none' }}>{task.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'library' && (
        <>
          {admin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowForm(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <Icon name="plus" size={16} /> สร้าง Protocol
              </button>
            </div>
          )}

          {showForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14 }}>Protocol ใหม่</div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อ *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inputStyle, width: '100%' }} placeholder="เช่น เช็คความสะอาดร้าน" />
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ความถี่</label>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} style={{ ...inputStyle, width: '100%' }}>
                    <option value="DAILY">ทุกวัน</option>
                    <option value="OPENING">เปิดร้าน</option>
                    <option value="CLOSING">ปิดร้าน</option>
                    <option value="WEEKLY">รายสัปดาห์</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>งานที่ต้องทำ</div>
                {tasks.map((task, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: 'var(--color-text-secondary)', width: 20, paddingTop: 10, fontSize: 12 }}>{i + 1}.</span>
                    <input value={task} onChange={e => { const t = [...tasks]; t[i] = e.target.value; setTasks(t); }} placeholder={`งานที่ ${i + 1}`} style={{ ...inputStyle, flex: 1 }} />
                    {tasks.length > 1 && (
                      <button onClick={() => setTasks(tasks.filter((_, j) => j !== i))} style={{ padding: '9px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}>
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setTasks([...tasks, ''])}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                  <Icon name="plus" size={14} /> เพิ่มงาน
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCreate} disabled={createProtocol.isPending}
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {createProtocol.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button onClick={() => setShowForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(protocols ?? []).map(protocol => {
              const freqInfo = FREQ_LABEL[protocol.frequency] ?? { label: protocol.frequency, tone: 'neutral' as const };
              return (
                <div key={protocol.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{protocol.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{protocol.tasks.length} งาน</div>
                  </div>
                  <Tag tone={freqInfo.tone}>{freqInfo.label}</Tag>
                </div>
              );
            })}
            {(protocols ?? []).length === 0 && !isLoading && (
              <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>ยังไม่มี Protocol</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
