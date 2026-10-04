import { create } from 'zustand';

/** A router picked on the discovery screen, handed to the sign-in screen. */
export interface AddTarget {
  baseUrl: string;
  /** Suggested name: the LuCI host name, or the address. */
  name: string;
}

interface AddDraftState {
  targets: AddTarget[];
  setTargets(targets: AddTarget[]): void;
}

/** In-memory hand-off between the add-router screens (never persisted). */
export const useAddDraft = create<AddDraftState>()((set) => ({
  targets: [],
  setTargets: (targets) => set({ targets }),
}));
