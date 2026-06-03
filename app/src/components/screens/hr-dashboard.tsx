'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, Select } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useAllLeaves, useMyLeaves, useCreateLeave, useReviewLeave,
  useTasks, useCreateTask, useUpdateTask, useConfirmTask, useDeleteTask,
  useStaffList, useCreateStaff, useUpdateStaff, useDeactivateStaff,
  type LeaveRequest, type TaskRead, type TaskStatus,
  type StaffRead, type StaffRole, type StaffPosition,
} from '@/hooks/use-hr';
import { ApiError } from '@/lib/api-client';

const LEAVE_TYPE_LABEL: Record<string, string> = {
  VACATION: 'ลาพักร้อน',
  SICK: 'ลาป่วย',
  PERSONAL: 'ลากิจ',
  OTHER: 'อื่นๆ',
};
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'รอการอนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ' };

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังทำ',
  PENDING_REVIEW: 'รอตรวจ',
  DONE: 'เสร็จแล้ว',
};
const TASK_STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  TODO: 'neutral',
  IN_PROGRESS: 'info',
  PENDING_REVIEW: 'warning',
  DONE: 'success',
};

function LeaveCard({ leave, admin, onReview }: { leave: LeaveRequest; admin: boolean; onReview?: (id: string, status: 'APPROVED' | 'REJECTED') => void }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--color-surface-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{leave.user_name || leave.user_id}</span>
          <Tag tone="info">{LEAVE_TYPE_LABEL[leave.leave_type] ?? leave.leave_type}</Tag>
          <Tag tone={STATUS_TONE[leave.status] ?? 'neutral'}>{STATUS_LABEL[leave.status] ?? leave.status}</Tag>
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: leave.note ? 4 : 0 }}>
          {leave.start_date} → {leave.end_date}
        </div>
        {leave.note && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{leave.note}</div>}
      </div>
      {admin && leave.status === 'PENDING' && onReview && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onReview(leave.id, 'APPROVED')}
            style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--color-success-50)', color: 'var(--color-success)', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none' }}>
            อนุมัติ
          </button>
          <button onClick={() => onReview(leave.id, 'REJECTED')}
            style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none' }}>
            ไม่อนุมัติ
          </button>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, admin, myId, onStatusChange, onConfirm, onDelete }: {
  task: TaskRead; admin: boolean; myId?: string;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isOverdue = task.due_date && task.status !== 'DONE' && task.due_date < new Date().toISOString().split('T')[0];
  return (
    <div style={{ padding: '12px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{task.title}</div>
          {task.description && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{task.description}</div>}
        </div>
        {admin && (
          <button onClick={() => onDelete(task.id)} title="ลบ" style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {task.assignee_name && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>→ {task.assignee_name}</span>}
        {task.due_date && (
          <span style={{ fontSize: 11, color: isOverdue ? 'var(--color-danger)' : 'var(--color-text-muted)', fontWeight: isOverdue ? 600 : 400 }}>
            {isOverdue ? '⚠ ' : ''}{task.due_date}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {task.status === 'TODO' && (
          <button onClick={() => onStatusChange(task.id, 'IN_PROGRESS')} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            เริ่มทำ
          </button>
        )}
        {task.status === 'IN_PROGRESS' && (
          <button onClick={() => onStatusChange(task.id, 'PENDING_REVIEW')} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-warning-50)', color: '#9C6A1F', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            ส่งตรวจ
          </button>
        )}
        {task.status === 'PENDING_REVIEW' && admin && (
          <button onClick={() => onConfirm(task.id)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-success-50)', color: 'var(--color-success)', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            ยืนยันเสร็จ
          </button>
        )}
        {admin && task.status !== 'DONE' && (
          <button onClick={() => onStatusChange(task.id, 'DONE')} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer' }}>
            ทำเสร็จ
          </button>
        )}
      </div>
    </div>
  );
}

// ── Staff Tab ─────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Owner', MANAGER: 'Manager', BARISTA: 'Barista', BAKER: 'Baker',
};
const POS_LABEL: Record<StaffPosition, string> = {
  JUNIOR: 'Junior', SENIOR: 'Senior', HEAD_OF_STAFF: 'Head of Staff',
};
const ALL_ROLES: StaffRole[] = ['OWNER', 'MANAGER', 'BARISTA', 'BAKER'];
const ALL_POSITIONS: StaffPosition[] = ['JUNIOR', 'SENIOR', 'HEAD_OF_STAFF'];

const EMPTY_CREATE = {
  name: '', role: 'BARISTA' as StaffRole, position: 'JUNIOR' as StaffPosition,
  pin: '', phone: '', email: '', address: '',
};

function StaffTab({ admin }: { admin: boolean }) {
  const toast = useToast();
  const { data: staffList, isLoading } = useStaffList();
  const createStaff    = useCreateStaff();
  const updateStaff    = useUpdateStaff();
  const deactivateStaff = useDeactivateStaff();

  const [showCreate, setShowCreate]         = useState(false);
  const [editTarget, setEditTarget]         = useState<StaffRead | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRead | null>(null);
  const [cForm, setCForm]                   = useState(EMPTY_CREATE);

  // Edit form state
  const [eName, setEName]         = useState('');
  const [eRole, setERole]         = useState<StaffRole>('BARISTA');
  const [ePosition, setEPosition] = useState<StaffPosition>('JUNIOR');
  const [ePin, setEPin]           = useState('');
  const [ePhone, setEPhone]       = useState('');
  const [eEmail, setEEmail]       = useState('');
  const [eAddress, setEAddress]   = useState('');

  const openEdit = (s: StaffRead) => {
    setEditTarget(s);
    setEName(s.name);
    setERole(s.role);
    setEPosition(s.position);
    setEPin('');
    setEPhone(s.phone ?? '');
    setEEmail(s.email ?? '');
    setEAddress(s.address ?? '');
  };

  const handleCreate = async () => {
    if (!cForm.name.trim() || !cForm.phone.trim() || !cForm.pin.trim()) {
      toast({ kind: 'warning', title: 'กรอกชื่อ เบอร์โทร และ PIN' });
      return;
    }
    try {
      await createStaff.mutateAsync({
        name: cForm.name.trim(),
        role: cForm.role,
        position: cForm.position,
        pin: cForm.pin,
        phone: cForm.phone.trim(),
        email: cForm.email.trim() || null,
        address: cForm.address.trim() || null,
      });
      setShowCreate(false);
      setCForm(EMPTY_CREATE);
      toast({ kind: 'success', title: 'เพิ่มพนักงานแล้ว' });
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? 'เบอร์โทรหรืออีเมลนี้มีพนักงานคนอื่นใช้อยู่แล้ว'
        : err instanceof Error ? err.message : 'กรุณาลองใหม่';
      toast({ kind: 'danger', title: 'เพิ่มพนักงานไม่สำเร็จ', msg });
    }
  };

  const handleUpdate = async () => {
    if (!editTarget) return;
    const payload: Record<string, unknown> = {};
    const trimName = eName.trim();
    if (trimName && trimName !== editTarget.name) payload.name = trimName;
    if (eRole !== editTarget.role) payload.role = eRole;
    if (ePosition !== editTarget.position) payload.position = ePosition;
    if (ePin.trim()) payload.pin = ePin.trim();
    if (ePhone.trim() !== (editTarget.phone ?? '')) payload.phone = ePhone.trim() || null;
    // email / address: null = clear, value = update, omit = no change
    const newEmail = eEmail.trim() || null;
    if (newEmail !== editTarget.email) payload.email = newEmail;
    const newAddress = eAddress.trim() || null;
    if (newAddress !== editTarget.address) payload.address = newAddress;

    try {
      await updateStaff.mutateAsync({ userId: editTarget.id, ...payload });
      setEditTarget(null);
      toast({ kind: 'success', title: 'อัพเดทพนักงานแล้ว' });
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? 'เบอร์โทรหรืออีเมลนี้มีพนักงานคนอื่นใช้อยู่แล้ว'
        : err instanceof Error ? err.message : 'กรุณาลองใหม่';
      toast({ kind: 'danger', title: 'อัพเดทไม่สำเร็จ', msg });
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await deactivateStaff.mutateAsync(deactivateTarget.id);
      setDeactivateTarget(null);
      toast({ kind: 'success', title: `${deactivateTarget.name} ออกจากระบบแล้ว` });
    } catch (err) {
      setDeactivateTarget(null);
      toast({ kind: 'danger', title: 'ดำเนินการไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const inputSt: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 7, border: '1px solid var(--color-border)',
    background: 'var(--color-surface-2)', color: 'var(--color-text)',
    fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const labelSt: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4,
  };

  if (isLoading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>กำลังโหลด…</div>
  );

  return (
    <>
      {admin && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => { setShowCreate(true); setCForm(EMPTY_CREATE); }}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}
          >
            <Icon name="plus" size={15} /> เพิ่มพนักงาน
          </button>
        </div>
      )}

      {/* Staff table */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-2)' }}>
              {['ชื่อ', 'Role', 'ตำแหน่ง', 'เบอร์โทร', 'อีเมล', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(staffList ?? []).map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '10px 16px', fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--color-accent-50)', color: 'var(--color-accent-700)' }}>
                    {ROLE_LABEL[s.role] ?? s.role}
                  </span>
                </td>
                <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                  {POS_LABEL[s.position] ?? s.position}
                </td>
                <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', fontSize: 13, fontFamily: 'var(--font-num)' }}>
                  {s.phone ?? <em style={{ color: 'var(--color-text-muted)' }}>—</em>}
                </td>
                <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                  {s.email ?? <em style={{ color: 'var(--color-text-muted)' }}>—</em>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {admin && (
                    <>
                      <button onClick={() => openEdit(s)}
                        style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginRight: 6 }}>
                        แก้ไข
                      </button>
                      <button onClick={() => setDeactivateTarget(s)}
                        style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        ลาออก
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!staffList?.length && (
              <tr>
                <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  ยังไม่มีพนักงาน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 24, width: 500, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700 }}>เพิ่มพนักงานใหม่</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>ชื่อ *</label>
                <input value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อพนักงาน" style={inputSt} autoFocus />
              </div>
              <div>
                <label style={labelSt}>Role *</label>
                <Select value={cForm.role} onChange={v => setCForm(f => ({ ...f, role: v as StaffRole }))} ariaLabel="Role" options={ALL_ROLES.map(r => ({ value: r, label: ROLE_LABEL[r] }))} />
              </div>
              <div>
                <label style={labelSt}>ตำแหน่ง *</label>
                <Select value={cForm.position} onChange={v => setCForm(f => ({ ...f, position: v as StaffPosition }))} ariaLabel="ตำแหน่ง" options={ALL_POSITIONS.map(p => ({ value: p, label: POS_LABEL[p] }))} />
              </div>
              <div>
                <label style={labelSt}>เบอร์โทร *</label>
                <input value={cForm.phone} onChange={e => setCForm(f => ({ ...f, phone: e.target.value }))} placeholder="0812345678" style={{ ...inputSt, fontFamily: 'var(--font-num)' }} />
              </div>
              <div>
                <label style={labelSt}>PIN (4–8 หลัก) *</label>
                <input value={cForm.pin} onChange={e => setCForm(f => ({ ...f, pin: e.target.value }))} placeholder="••••" type="password" style={{ ...inputSt, fontFamily: 'var(--font-num)' }} />
              </div>
              <div>
                <label style={labelSt}>อีเมล</label>
                <input value={cForm.email} onChange={e => setCForm(f => ({ ...f, email: e.target.value }))} placeholder="ไม่บังคับ" type="email" style={inputSt} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>ที่อยู่</label>
                <textarea value={cForm.address} onChange={e => setCForm(f => ({ ...f, address: e.target.value }))} rows={2} placeholder="ไม่บังคับ" style={{ ...inputSt, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handleCreate} disabled={createStaff.isPending}
                style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}>
                {createStaff.isPending ? 'กำลังเพิ่ม…' : 'เพิ่ม'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 24, width: 500, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700 }}>แก้ไขพนักงาน — {editTarget.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>ชื่อ</label>
                <input value={eName} onChange={e => setEName(e.target.value)} style={inputSt} />
              </div>
              <div>
                <label style={labelSt}>Role</label>
                <Select value={eRole} onChange={v => setERole(v as StaffRole)} ariaLabel="Role" options={ALL_ROLES.map(r => ({ value: r, label: ROLE_LABEL[r] }))} />
              </div>
              <div>
                <label style={labelSt}>ตำแหน่ง</label>
                <Select value={ePosition} onChange={v => setEPosition(v as StaffPosition)} ariaLabel="ตำแหน่ง" options={ALL_POSITIONS.map(p => ({ value: p, label: POS_LABEL[p] }))} />
              </div>
              <div>
                <label style={labelSt}>เบอร์โทร</label>
                <input value={ePhone} onChange={e => setEPhone(e.target.value)} style={{ ...inputSt, fontFamily: 'var(--font-num)' }} />
              </div>
              <div>
                <label style={labelSt}>PIN ใหม่ (ว่าง = ไม่เปลี่ยน)</label>
                <input value={ePin} onChange={e => setEPin(e.target.value)} placeholder="ว่าง = ไม่เปลี่ยน" type="password" style={{ ...inputSt, fontFamily: 'var(--font-num)' }} />
              </div>
              <div>
                <label style={labelSt}>อีเมล (ว่าง = ลบออก)</label>
                <input value={eEmail} onChange={e => setEEmail(e.target.value)} type="email" style={inputSt} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>ที่อยู่ (ว่าง = ลบออก)</label>
                <textarea value={eAddress} onChange={e => setEAddress(e.target.value)} rows={2} style={{ ...inputSt, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditTarget(null)} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handleUpdate} disabled={updateStaff.isPending}
                style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}>
                {updateStaff.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate confirm */}
      {deactivateTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 24, width: 360, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>ยืนยันการลาออก</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              <strong>{deactivateTarget.name}</strong> จะถูกปิดการใช้งาน ไม่สามารถล็อกอินได้อีก แต่ประวัติการทำงานยังคงอยู่
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeactivateTarget(null)} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handleDeactivate} disabled={deactivateStaff.isPending}
                style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-danger)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}>
                {deactivateStaff.isPending ? 'กำลังดำเนินการ…' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const KANBAN_COLS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'DONE'];
const COL_COLORS: Record<TaskStatus, { bg: string; border: string }> = {
  TODO:           { bg: '#F8FAFC', border: '#E2E8F0' },
  IN_PROGRESS:    { bg: '#EFF6FF', border: '#BFDBFE' },
  PENDING_REVIEW: { bg: '#FFFBEB', border: '#FDE68A' },
  DONE:           { bg: '#F0FDF4', border: '#BBF7D0' },
};

function TasksTab({ admin, myId }: { admin: boolean; myId?: string }) {
  const toast = useToast();
  const { data: allTasks } = useTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const confirmTask = useConfirmTask();
  const deleteTask = useDeleteTask();
  const { data: staff } = useStaffList();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignee_id: '', due_date: '' });

  const tasks = allTasks ?? [];

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    try {
      await updateTask.mutateAsync({ taskId, status });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleConfirm = async (taskId: string) => {
    try {
      await confirmTask.mutateAsync(taskId);
      toast({ kind: 'success', title: 'ยืนยันงานเสร็จแล้ว' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask.mutateAsync(taskId);
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { toast({ kind: 'warning', title: 'ระบุชื่องาน' }); return; }
    try {
      await createTask.mutateAsync({
        title: form.title.trim(),
        description: form.description || undefined,
        assignee_id: form.assignee_id || undefined,
        due_date: form.due_date || undefined,
      });
      toast({ kind: 'success', title: 'สร้างงานแล้ว' });
      setShowCreateForm(false);
      setForm({ title: '', description: '', assignee_id: '', due_date: '' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const inputSt: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div>
      {admin && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowCreateForm(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}>
            <Icon name="plus" size={15} /> สร้างงานใหม่
          </button>

          {showCreateForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>งานใหม่</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่องาน *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="เช่น เติมน้ำตาลสถานี" style={inputSt} autoFocus />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>รายละเอียด</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="ไม่บังคับ" style={{ ...inputSt, resize: 'vertical' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>มอบหมายให้</label>
                  <Select value={form.assignee_id} onChange={v => setForm(f => ({ ...f, assignee_id: v }))} ariaLabel="มอบหมายให้" options={[
                    { value: '', label: 'ไม่ระบุ' },
                    ...(staff ?? []).map(s => ({ value: s.id, label: s.name })),
                  ]} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ครบกำหนด</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={inputSt} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCreate} disabled={createTask.isPending}
                  style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none' }}>
                  {createTask.isPending ? '...' : 'สร้าง'}
                </button>
                <button onClick={() => setShowCreateForm(false)}
                  style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kanban board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {KANBAN_COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col);
          const { bg, border } = COL_COLORS[col];
          return (
            <div key={col} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 12, minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Tag tone={TASK_STATUS_TONE[col]}>{TASK_STATUS_LABEL[col]}</Tag>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{colTasks.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colTasks.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 0' }}>ว่างอยู่</div>
                ) : colTasks.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    admin={admin}
                    myId={myId}
                    onStatusChange={handleStatusChange}
                    onConfirm={handleConfirm}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HRDashboard() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: allLeaves } = useAllLeaves();
  const { data: myLeaves } = useMyLeaves();
  const createLeave = useCreateLeave();
  const reviewLeave = useReviewLeave();

  const [tab, setTab] = useState(admin ? 'overview' : 'my-leaves');
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ start_date: '', end_date: '', leave_type: 'VACATION', note: '' });

  const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await reviewLeave.mutateAsync({ id, status });
      toast({ kind: 'success', title: status === 'APPROVED' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleCreateLeave = async () => {
    if (!leaveForm.start_date || !leaveForm.end_date) { toast({ kind: 'warning', title: 'กรอกวันที่' }); return; }
    try {
      await createLeave.mutateAsync({
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        leave_type: leaveForm.leave_type,
        note: leaveForm.note || undefined,
      });
      toast({ kind: 'success', title: 'ส่งคำขอลาแล้ว' });
      setShowLeaveForm(false);
      setLeaveForm({ start_date: '', end_date: '', leave_type: 'VACATION', note: '' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const adminTabs = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'staff', label: 'พนักงาน' },
    { id: 'leaves', label: 'จัดการวันลา' },
    { id: 'tasks', label: 'งาน / Tasks' },
    { id: 'calendar', label: 'ปฏิทินทีม' },
  ];
  const staffTabs = [
    { id: 'my-leaves', label: 'วันลาของฉัน' },
    { id: 'tasks', label: 'งานของฉัน' },
    { id: 'calendar', label: 'ปฏิทินทีม' },
  ];
  const tabs = admin ? adminTabs : staffTabs;

  const inputStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 } as React.CSSProperties;

  // Build a simple month calendar from approved leaves
  const leaves = (admin ? (allLeaves ?? []) : (myLeaves ?? []));
  const approvedLeaves = leaves.filter(l => l.status === 'APPROVED');

  const buildCalendar = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const leaveByDate: Record<string, string[]> = {};
    approvedLeaves.forEach(l => {
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        if (!leaveByDate[key]) leaveByDate[key] = [];
        leaveByDate[key].push(l.user_name || 'พนักงาน');
      }
    });

    return { firstDay: (firstDay + 6) % 7, daysInMonth, leaveByDate, year, month };
  };

  const { firstDay, daysInMonth, leaveByDate, year, month } = buildCalendar();

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>
        HR & Admin
      </h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 14, fontWeight: tab === t.id ? 600 : 500, color: tab === t.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: tab === t.id ? 'var(--color-surface)' : 'transparent', borderBottom: tab === t.id ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Admin overview */}
      {tab === 'overview' && admin && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'คำขอลารออนุมัติ', val: (allLeaves ?? []).filter(l => l.status === 'PENDING').length },
              { label: 'อนุมัติแล้วเดือนนี้', val: (allLeaves ?? []).filter(l => l.status === 'APPROVED').length },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{k.val}</div>
              </div>
            ))}
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>ดู KPI รายพนักงานได้ที่ Dashboard → รายงาน</div>
        </div>
      )}

      {/* Staff management */}
      {tab === 'staff' && admin && <StaffTab admin={admin} />}

      {/* Admin leave management */}
      {tab === 'leaves' && admin && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>คำขอลาทั้งหมด ({(allLeaves ?? []).length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(allLeaves ?? []).length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 32 }}>ยังไม่มีคำขอ</div>
            ) : (
              (allLeaves ?? []).map(l => <LeaveCard key={l.id} leave={l} admin={admin} onReview={handleReview} />)
            )}
          </div>
        </div>
      )}

      {/* Tasks kanban (both admin and staff) */}
      {tab === 'tasks' && <TasksTab admin={admin} myId={me?.id} />}

      {/* Staff my leaves */}
      {tab === 'my-leaves' && !admin && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>วันลาของฉัน</div>
            <button onClick={() => setShowLeaveForm(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              <Icon name="plus" size={15} /> ขอลา
            </button>
          </div>

          {showLeaveForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>ขอลา</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเริ่ม *</label>
                  <input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันสิ้นสุด *</label>
                  <input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ประเภท</label>
                  <Select value={leaveForm.leave_type} onChange={v => setLeaveForm(f => ({ ...f, leave_type: v }))} ariaLabel="ประเภท" options={Object.entries(LEAVE_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l as string }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input value={leaveForm.note} onChange={e => setLeaveForm(f => ({ ...f, note: e.target.value }))} placeholder="ไม่บังคับ" style={{ ...inputStyle, width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCreateLeave} disabled={createLeave.isPending}
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {createLeave.isPending ? '...' : 'ส่งคำขอ'}
                </button>
                <button onClick={() => setShowLeaveForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(myLeaves ?? []).length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 32 }}>ยังไม่มีคำขอ</div>
            ) : (
              (myLeaves ?? []).map(l => <LeaveCard key={l.id} leave={l} admin={false} />)
            )}
          </div>
        </div>
      )}

      {/* Team calendar */}
      {tab === 'calendar' && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>
            {new Date(year, month).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', padding: '4px 0' }}>{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const names = leaveByDate[dateStr] ?? [];
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              return (
                <div key={d} style={{ minHeight: 56, borderRadius: 8, border: `1px solid ${isToday ? 'var(--color-accent)' : 'var(--color-border)'}`, padding: '4px 6px', background: isToday ? 'rgba(212,165,116,0.08)' : 'var(--color-surface)' }}>
                  <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--color-accent)' : 'var(--color-text)', marginBottom: 2 }}>{d}</div>
                  {names.map((n, ni) => (
                    <div key={ni} style={{ fontSize: 9, background: 'var(--color-danger-50)', color: 'var(--color-danger)', borderRadius: 3, padding: '1px 4px', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>แสดงเฉพาะวันลาที่อนุมัติแล้ว</div>
        </div>
      )}
    </div>
  );
}
