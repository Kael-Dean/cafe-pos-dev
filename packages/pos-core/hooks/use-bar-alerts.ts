'use client';

import { create } from 'zustand';
import type { RealtimeStatus } from '@pos/core/lib/realtime/pusher-socket';
import type { FirstOrderMemory } from '@pos/core/lib/table-ordering/new-table';

/**
 * Device-level state of the bar screen: sound on/off (persisted), whether the
 * browser has unlocked audio yet, the screen wake lock, the realtime socket and
 * the new guest orders the owner has not looked at yet. Shared by the global
 * watcher (components/bar/bar-watcher.tsx) and the order board.
 */

const SOUND_KEY = 'kafe:bar-sound';
const WAKE_KEY = 'kafe:bar-wake';
const FIRST_KEY = 'kafe:bar-first-orders';

const readBool = (k: string, d: boolean) => {
  if (typeof localStorage === 'undefined') return d;
  const v = localStorage.getItem(k);
  return v === null ? d : v === '1';
};
const writeBool = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

export function readFirstOrders(): FirstOrderMemory {
  if (typeof localStorage === 'undefined') return {};
  try {
    const v = JSON.parse(localStorage.getItem(FIRST_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as FirstOrderMemory) : {};
  } catch { return {}; }
}

export interface UnseenOrder { id: string; tableName: string | null; guestLabel: string | null; at: number }

interface BarAlertState {
  soundOn: boolean;
  audioUnlocked: boolean;
  wakeWanted: boolean;
  wakeActive: boolean;
  realtime: RealtimeStatus;
  unseen: UnseenOrder[];
  firstOrders: FirstOrderMemory;
  setSoundOn: (v: boolean) => void;
  setAudioUnlocked: (v: boolean) => void;
  setWakeWanted: (v: boolean) => void;
  setWakeActive: (v: boolean) => void;
  setRealtime: (v: RealtimeStatus) => void;
  pushUnseen: (o: UnseenOrder[]) => void;
  clearUnseen: () => void;
  setFirstOrders: (m: FirstOrderMemory) => void;
}

export const useBarAlerts = create<BarAlertState>((set, get) => ({
  soundOn: readBool(SOUND_KEY, true),
  audioUnlocked: false,
  wakeWanted: readBool(WAKE_KEY, false),
  wakeActive: false,
  realtime: 'off',
  unseen: [],
  firstOrders: readFirstOrders(),
  setSoundOn: (v) => { writeBool(SOUND_KEY, v); set({ soundOn: v }); },
  setAudioUnlocked: (v) => set({ audioUnlocked: v }),
  setWakeWanted: (v) => { writeBool(WAKE_KEY, v); set({ wakeWanted: v }); },
  setWakeActive: (v) => set({ wakeActive: v }),
  setRealtime: (v) => set({ realtime: v }),
  pushUnseen: (o) => {
    if (!o.length) return;
    const have = new Set(get().unseen.map((u) => u.id));
    set({ unseen: [...get().unseen, ...o.filter((u) => !have.has(u.id))] });
  },
  clearUnseen: () => { if (get().unseen.length) set({ unseen: [] }); },
  setFirstOrders: (m) => {
    if (m === get().firstOrders) return;
    try { localStorage.setItem(FIRST_KEY, JSON.stringify(m)); } catch { /* ignore */ }
    set({ firstOrders: m });
  },
}));
