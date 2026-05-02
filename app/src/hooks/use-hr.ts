import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface StaffMember {
  id: string;
  name: string;
  role: 'OWNER' | 'MANAGER' | 'BARISTA' | 'BAKER';
}

export interface LeaveRequest {
  id: string;
  store_id: string;
  user_id: string;
  user_name: string;
  start_date: string;
  end_date: string;
  leave_type: 'VACATION' | 'SICK' | 'PERSONAL' | 'OTHER';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShiftAssignment {
  id: string;
  store_id: string;
  user_id: string;
  user_name: string;
  assignment_date: string;
  shift_type: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'FULL_DAY' | 'OFF';
  notes: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

const STAFF_KEY = ['hr-staff'] as const;
const LEAVES_KEY = ['hr-leaves'] as const;
const MY_LEAVES_KEY = ['hr-my-leaves'] as const;

export function useStaffList() {
  return useQuery<StaffMember[]>({
    queryKey: STAFF_KEY,
    queryFn: () => api.get<StaffMember[]>('/api/v1/hr/staff'),
  });
}

export function useAllLeaves() {
  return useQuery<LeaveRequest[]>({
    queryKey: LEAVES_KEY,
    queryFn: () => api.get<LeaveRequest[]>('/api/v1/hr/leaves'),
  });
}

export function useMyLeaves() {
  return useQuery<LeaveRequest[]>({
    queryKey: MY_LEAVES_KEY,
    queryFn: () => api.get<LeaveRequest[]>('/api/v1/hr/leaves/mine'),
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      start_date: string;
      end_date: string;
      leave_type: string;
      note?: string;
    }) => api.post<LeaveRequest>('/api/v1/hr/leaves', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVES_KEY });
      qc.invalidateQueries({ queryKey: MY_LEAVES_KEY });
    },
  });
}

export function useReviewLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      api.patch<LeaveRequest>(`/api/v1/hr/leaves/${id}/review`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LEAVES_KEY }),
  });
}

export function useWeeklySchedule(weekStart: string) {
  return useQuery<ShiftAssignment[]>({
    queryKey: ['hr-shifts', weekStart],
    queryFn: () => api.get<ShiftAssignment[]>(`/api/v1/hr/shifts?week_start=${weekStart}`),
    enabled: !!weekStart,
  });
}

export function useAssignShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      user_id: string;
      assignment_date: string;
      shift_type: string;
      notes?: string;
    }) => api.post<ShiftAssignment>('/api/v1/hr/shifts', payload),
    onSuccess: (_data, vars) => {
      const d = new Date(vars.assignment_date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff)).toISOString().split('T')[0];
      qc.invalidateQueries({ queryKey: ['hr-shifts', weekStart] });
    },
  });
}
