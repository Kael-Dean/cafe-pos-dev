'use client';

import { useState, useMemo } from 'react';
import Icon from '../icons';
import { useToast, Tag, Select } from '../app-common';
import { useFadeRise } from '@/lib/motion';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useProtocols, useCreateProtocol, useTodayProtocolLogs, useLogProtocol, type Protocol } from '@/hooks/use-protocols';

const FREQ_META: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'accent'; color: string; bg: string; icon: string }> = {
  OPENING: { label: 'เปิดร้าน',    tone: 'info',    color: 'var(--color-info)',    bg: 'var(--color-info-50)',    icon: 'sun' },
  DAILY:   { label: 'ระหว่างวัน',  tone: 'success', color: 'var(--color-success)', bg: 'var(--color-success-50)', icon: 'coffee' },
  CLOSING: { label: 'ปิดร้าน',     tone: 'warning', color: 'var(--color-warning)', bg: 'var(--color-warning-50)', icon: 'moon' },
  WEEKLY:  { label: 'รายสัปดาห์', tone: 'accent',  color: 'var(--color-accent-600)', bg: 'var(--color-accent-50)', icon: 'calendar' },
};

const FREQ_ORDER = ['OPENING', 'DAILY', 'CLOSING', 'WEEKLY'];

function ProgressRing({ pct, size, stroke }: { pct: number; size: number; stroke: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={pct === 100 ? 'var(--color-success)' : 'var(--color-accent)'}
        strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={dash}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.2,0.8,0.2,1)' }} />
    </svg>
  );
}

const todayStr = () => new Date().toISOString().split('T')[0];

const IS = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14,
} as React.CSSProperties;

export default function ProtocolsScreen() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: protocols, isLoading } = useProtocols();
  const { data: logs } = useTodayProtocolLogs();
  const createProtocol = useCreateProtocol();
  const logProtocol = useLogProtocol();

  const screenRef = useFadeRise();
  const [tab, setTab] = useState<'checklist' | 'library'>('checklist');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', frequency: 'OPENING' });
  const [tasks, setTasks] = useState<string[]>(['']);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    OPENING: true, DAILY: true, CLOSING: true, WEEKLY: true,
  });

  const logMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    (logs ?? []).forEach(l => { m[l.protocol_id] = l.completed_task_ids; });
    return m;
  }, [logs]);

  const grouped = useMemo(() => {
    const g: Record<string, Protocol[]> = {};
    (protocols ?? []).forEach(p => {
      if (!g[p.frequency]) g[p.frequency] = [];
      g[p.frequency].push(p);
    });
    return g;
  }, [protocols]);

  const totalTasks = (protocols ?? []).reduce((s, p) => s + p.tasks.length, 0);
  const totalDone = (protocols ?? []).reduce((s, p) => s + (logMap[p.id]?.length ?? 0), 0);
  const overallPct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;

  const handleCheck = async (protocol: Protocol, taskId: string, checked: boolean) => {
    const current = logMap[protocol.id] ?? [];
    const next = checked ? [...current, taskId] : current.filter(id => id !== taskId);
    try {
      await logProtocol.mutateAsync({ protocol_id: protocol.id, log_date: todayStr(), completed_task_ids: next });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อ Protocol' }); return; }
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
      setForm({ name: '', description: '', frequency: 'OPENING' });
      setTasks(['']);
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  return (
    <div ref={screenRef} style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>Protocols / SOP</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>เช็คลิสต์การปฏิบัติงานประจำร้านกาแฟ</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '12px 20px', boxShadow: 'var(--shadow-sm)' }}>
          <ProgressRing pct={overallPct} size={52} stroke={5} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {totalDone}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-secondary)' }}>/{totalTasks}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>งานวันนี้</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        {(['checklist', 'library'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 14, fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: tab === t ? 'var(--color-surface)' : 'transparent', borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer', transition: 'all 150ms' }}>
            {t === 'checklist' ? '✓ Checklist วันนี้' : '📋 คลัง Protocol'}
          </button>
        ))}
      </div>

      {tab === 'checklist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-busy="true">
              <span className="sr-only">กำลังโหลดเช็คลิสต์</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <Skeleton height={44} radius="var(--radius-lg)" style={{ marginBottom: 'var(--space-3)' }} />
                  <SkeletonCard lines={3} style={{ borderRadius: 12, padding: 18 }} />
                </div>
              ))}
            </div>
          )}
          {!isLoading && (protocols ?? []).length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>ยังไม่มี Protocol กดแท็บ &quot;คลัง&quot; เพื่อสร้าง</div>
          )}
          {FREQ_ORDER.map(freq => {
            const group = grouped[freq];
            if (!group) return null;
            const meta = FREQ_META[freq] ?? { label: freq, color: 'var(--color-text)', bg: 'var(--color-surface-2)', icon: 'check' };
            const groupDone = group.reduce((s, p) => s + (logMap[p.id]?.length ?? 0), 0);
            const groupTotal = group.reduce((s, p) => s + p.tasks.length, 0);
            const open = expandedGroups[freq] !== false;

            return (
              <div key={freq} style={{ marginBottom: 8 }}>
                <button
                  onClick={() => setExpandedGroups(e => ({ ...e, [freq]: !open }))}
                  className="hover-raise hit-44"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', minHeight: 44, boxSizing: 'border-box', borderRadius: 10, background: meta.bg, border: '1px solid var(--color-border)', cursor: 'pointer', marginBottom: open ? 10 : 0, transition: 'all 150ms' }}>
                  <Icon name={meta.icon} size={16} color={meta.color} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: meta.color, flex: 1, textAlign: 'left' }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: meta.color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{groupDone}/{groupTotal}</span>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} color={meta.color} />
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
                    {group.map(protocol => {
                      const completed = logMap[protocol.id] ?? [];
                      const pct = protocol.tasks.length > 0 ? Math.round((completed.length / protocol.tasks.length) * 100) : 0;
                      const done = completed.length === protocol.tasks.length && protocol.tasks.length > 0;
                      return (
                        <div key={protocol.id} style={{ background: 'var(--color-surface)', border: `1px solid ${done ? 'var(--color-success-50)' : 'var(--color-border)'}`, borderRadius: 12, padding: 18, boxShadow: 'var(--shadow-xs)', transition: 'border-color 300ms' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600, fontSize: 15 }}>{protocol.name}</span>
                              {done && <Tag tone="success">✓ เสร็จแล้ว</Tag>}
                            </div>
                            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{completed.length}/{protocol.tasks.length}</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--color-surface-2)', borderRadius: 99, marginBottom: 12, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: done ? 'var(--color-success)' : 'var(--color-accent)', borderRadius: 99, transition: 'width 300ms cubic-bezier(0.2,0.8,0.2,1)' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {protocol.tasks.map(task => {
                              const checked = completed.includes(task.id);
                              return (
                                <label key={task.id} onClick={() => handleCheck(protocol, task.id, !checked)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '9px 10px', minHeight: 44, boxSizing: 'border-box', borderRadius: 7, background: checked ? 'var(--color-success-50)' : 'transparent', transition: 'background 150ms', userSelect: 'none' }}>
                                  <div
                                    style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked ? 'var(--color-success)' : 'var(--color-border-strong)'}`, background: checked ? 'var(--color-success)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 150ms', cursor: 'pointer' }}>
                                    {checked && <Icon name="check" size={11} color="var(--color-text-inverse)" strokeWidth={3} />}
                                  </div>
                                  <span style={{ fontSize: 14, color: checked ? 'var(--color-success)' : 'var(--color-text)', textDecoration: checked ? 'line-through' : 'none', transition: 'all 150ms' }}>{task.title}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'library' && (
        <div>
          {admin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowForm(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <Icon name="plus" size={15} /> สร้าง Protocol
              </button>
            </div>
          )}

          {showForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Protocol ใหม่</div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อ *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น เช็คความสะอาดร้าน" />
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ช่วงเวลา</label>
                  <Select value={form.frequency} onChange={v => setForm(f => ({ ...f, frequency: v }))} ariaLabel="ช่วงเวลา" options={[
                    { value: 'OPENING', label: 'เปิดร้าน' },
                    { value: 'DAILY', label: 'ระหว่างวัน' },
                    { value: 'CLOSING', label: 'ปิดร้าน' },
                    { value: 'WEEKLY', label: 'รายสัปดาห์' },
                  ]} />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6, fontWeight: 500 }}>งานที่ต้องทำ</div>
                {tasks.map((task, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <span style={{ color: 'var(--color-text-muted)', width: 20, fontSize: 12, flexShrink: 0, paddingTop: 2 }}>{i + 1}.</span>
                    <input value={task} onChange={e => { const t = [...tasks]; t[i] = e.target.value; setTasks(t); }} placeholder={`งานที่ ${i + 1}`} style={{ ...IS, flex: 1 }} />
                    {tasks.length > 1 && (
                      <button onClick={() => setTasks(tasks.filter((_, j) => j !== i))} aria-label={`ลบงานที่ ${i + 1}`} style={{ minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center', padding: 8, borderRadius: 7, border: '1px solid var(--color-border)', color: 'var(--color-danger)', flexShrink: 0, cursor: 'pointer' }}>
                        <Icon name="x" size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setTasks([...tasks, ''])}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                  <Icon name="plus" size={13} /> เพิ่มงาน
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCreate} disabled={createProtocol.isPending}
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {createProtocol.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button onClick={() => setShowForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {!isLoading && (protocols ?? []).length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40, gridColumn: '1/-1' }}>ยังไม่มี Protocol</div>
            )}
            {(protocols ?? []).map(protocol => {
              const meta = FREQ_META[protocol.frequency] ?? { label: protocol.frequency, tone: 'neutral' as const, color: 'var(--color-text)', bg: 'var(--color-surface-2)', icon: 'check' };
              return (
                <div key={protocol.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow-xs)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{protocol.name}</div>
                    <Tag tone={meta.tone}>{meta.label}</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{protocol.tasks.length} งาน</div>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {protocol.tasks.slice(0, 3).map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        <div style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--color-border-strong)', flexShrink: 0 }} />
                        {t.title}
                      </div>
                    ))}
                    {protocol.tasks.length > 3 && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>+{protocol.tasks.length - 3} งานอื่น...</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
