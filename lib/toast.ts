import { create } from 'zustand';

export type ToastTone = 'error' | 'info' | 'success';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  /** Mounted `<ToastHost>` ids, oldest first. Only the newest renders, so a host inside an open
   *  Modal (a separate native window) takes over from the root one instead of doubling up. */
  hosts: number[];
  dismiss: (id: number) => void;
  registerHost: (id: number) => () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  hosts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  registerHost: (id) => {
    set((state) => ({ hosts: [...state.hosts, id] }));
    return () => set((state) => ({ hosts: state.hosts.filter((h) => h !== id) }));
  },
}));

let nextToastId = 1;

/** Shows a short message from anywhere, including store actions. Errors linger a little longer. */
export function toast(message: string, tone: ToastTone = 'error', durationMs = tone === 'error' ? 4200 : 2600): void {
  const id = nextToastId++;
  // A repeat of the message already on screen would just stack; refresh it instead.
  useToastStore.setState((state) => ({
    toasts: [...state.toasts.filter((t) => t.message !== message), { id, message, tone }].slice(-2),
  }));
  setTimeout(() => useToastStore.getState().dismiss(id), durationMs);
}
