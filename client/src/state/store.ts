import { useSyncExternalStore } from 'react';

import { DEFAULT_ARENA_ID } from '@pfa/shared';
import type {
  AiDifficulty,
  MatchResultView,
  PlayerProfile,
  PlayerSlot,
  RoomView,
  StorageStatus,
} from '@pfa/shared';

export type Screen =
  | 'menu'
  | 'lobby'
  | 'match'
  | 'workshop'
  | 'leaderboard'
  | 'profile'
  | 'settings';

export interface GameSettings {
  masterVolume: number;
  sfxEnabled: boolean;
  /** Pixel ratio cap; lower this on weak hardware. */
  quality: 'low' | 'medium' | 'high';
  aimSensitivity: number;
  showHints: boolean;
}

export interface Toast {
  id: number;
  tone: 'info' | 'warn' | 'error' | 'good';
  message: string;
}

export interface AppState {
  screen: Screen;
  previousScreen: Screen;
  connected: boolean;
  profile: PlayerProfile | null;
  storage: StorageStatus | null;
  room: RoomView | null;
  slot: PlayerSlot | null;
  countdown: number | null;
  result: MatchResultView | null;
  selectedArena: string;
  selectedMode: 'casual' | 'ranked';
  /** Difficulty used the next time a Play vs AI match starts. */
  selectedDifficulty: AiDifficulty;
  pingMs: number;
  settings: GameSettings;
  toasts: Toast[];
  busy: boolean;
}

const SETTINGS_KEY = 'pfa.settings.v1';

function loadSettings(): GameSettings {
  const fallback: GameSettings = {
    masterVolume: 0.7,
    sfxEnabled: true,
    quality: 'high',
    aimSensitivity: 1,
    showHints: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

const initialState: AppState = {
  screen: 'menu',
  previousScreen: 'menu',
  connected: false,
  profile: null,
  storage: null,
  room: null,
  slot: null,
  countdown: null,
  result: null,
  selectedArena: DEFAULT_ARENA_ID,
  selectedMode: 'casual',
  selectedDifficulty: 'medium',
  pingMs: 0,
  settings: loadSettings(),
  toasts: [],
  busy: false,
};

type Listener = () => void;

/**
 * Tiny external store.
 *
 * Deliberately hand-rolled rather than pulled from a library: the only things
 * that live here are low-frequency (screen, profile, room). Per-frame match
 * data never touches React - it stays in the snapshot buffer and is read
 * inside the render loop, which is what keeps 60 fps off the reconciler.
 */
class Store {
  private state: AppState = initialState;
  private listeners = new Set<Listener>();
  private toastId = 0;

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set = (patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void => {
    const resolved = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...resolved };
    for (const listener of this.listeners) listener();
  };

  navigate = (screen: Screen): void => {
    this.set((current) => ({ screen, previousScreen: current.screen }));
  };

  updateSettings = (patch: Partial<GameSettings>): void => {
    const settings = { ...this.state.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing with storage blocked: keep the setting for this session only.
    }
    this.set({ settings });
  };

  toast = (message: string, tone: Toast['tone'] = 'info'): void => {
    this.toastId += 1;
    const id = this.toastId;
    this.set((current) => ({ toasts: [...current.toasts, { id, tone, message }] }));
    setTimeout(() => {
      this.set((current) => ({ toasts: current.toasts.filter((item) => item.id !== id) }));
    }, 4200);
  };
}

export const store = new Store();

/** Subscribes a component to the whole state object. */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
