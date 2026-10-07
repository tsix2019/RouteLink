/**
 * The active router's latest state for the home-screen widgets (design §19), as raw values: the app, the
 * background check and the widgets' own ↻ button all write it; each widget formats what it needs.
 */
export interface WidgetData {
  name: string;
  online: boolean;
  /** ↻ can read the router again from the home screen: its password is saved (or it is the demo router). */
  refreshable?: boolean;
  devicesOnline?: number;
  devicesTotal?: number;
  wifi?: number;
  wired?: number;
  /** A few online devices, by name. */
  deviceNames?: string[];
  rxBps?: number;
  txBps?: number;
  /** 1-minute load over the core count, 0..1. */
  cpu?: number;
  /** Memory in use, 0..1. */
  memory?: number;
  /** °C */
  temperature?: number;
  uptimeSec?: number;
  wanUp?: boolean;
  wanIp?: string;
  wanProto?: string;
  /** When the data was read, ms. */
  updatedAt: number;
}

/** How many device names a widget gets: the largest one has room for six. */
export const DEVICE_NAMES = 6;
