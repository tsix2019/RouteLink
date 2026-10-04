import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';

type MdName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One name per concept: SF Symbol on iOS, Material Community icon elsewhere. */
export const ICONS = {
  overview: { sf: 'gauge.with.dots.needle.67percent', md: 'gauge' },
  devices: { sf: 'laptopcomputer.and.iphone', md: 'devices' },
  wifi: { sf: 'wifi', md: 'wifi' },
  wifiOff: { sf: 'wifi.slash', md: 'wifi-off' },
  network: { sf: 'network', md: 'lan' },
  more: { sf: 'ellipsis.circle', md: 'dots-horizontal-circle-outline' },
  router: { sf: 'wifi.router', md: 'router-wireless' },
  chevronRight: { sf: 'chevron.right', md: 'chevron-right' },
  chevronDown: { sf: 'chevron.down', md: 'chevron-down' },
  check: { sf: 'checkmark', md: 'check' },
  plus: { sf: 'plus', md: 'plus' },
  refresh: { sf: 'arrow.clockwise', md: 'refresh' },
  power: { sf: 'power', md: 'power' },
  cpu: { sf: 'cpu', md: 'chip' },
  memory: { sf: 'memorychip', md: 'memory' },
  storage: { sf: 'internaldrive', md: 'harddisk' },
  temperature: { sf: 'thermometer.medium', md: 'thermometer' },
  globe: { sf: 'globe', md: 'web' },
  down: { sf: 'arrow.down', md: 'arrow-down' },
  up: { sf: 'arrow.up', md: 'arrow-up' },
  phone: { sf: 'iphone', md: 'cellphone' },
  laptop: { sf: 'laptopcomputer', md: 'laptop' },
  desktop: { sf: 'desktopcomputer', md: 'desktop-tower-monitor' },
  tablet: { sf: 'ipad', md: 'tablet' },
  tv: { sf: 'tv', md: 'television' },
  printer: { sf: 'printer', md: 'printer' },
  game: { sf: 'gamecontroller', md: 'gamepad-variant' },
  camera: { sf: 'web.camera', md: 'cctv' },
  speaker: { sf: 'hifispeaker', md: 'speaker' },
  plug: { sf: 'powerplug', md: 'power-plug' },
  server: { sf: 'server.rack', md: 'server' },
  unknownDevice: { sf: 'questionmark.circle', md: 'help-circle-outline' },
  ethernet: { sf: 'cable.connector', md: 'ethernet' },
  lock: { sf: 'lock.fill', md: 'lock' },
  lockOpen: { sf: 'lock.open', md: 'lock-open-variant' },
  eye: { sf: 'eye', md: 'eye' },
  eyeOff: { sf: 'eye.slash', md: 'eye-off' },
  search: { sf: 'magnifyingglass', md: 'magnify' },
  trash: { sf: 'trash', md: 'trash-can-outline' },
  edit: { sf: 'pencil', md: 'pencil' },
  scan: { sf: 'dot.radiowaves.left.and.right', md: 'radar' },
  info: { sf: 'info.circle', md: 'information-outline' },
  warning: { sf: 'exclamationmark.triangle', md: 'alert' },
  error: { sf: 'exclamationmark.octagon', md: 'alert-octagon' },
  settings: { sf: 'gearshape', md: 'cog' },
  language: { sf: 'character.bubble', md: 'translate' },
  appearance: { sf: 'circle.lefthalf.filled', md: 'theme-light-dark' },
  timer: { sf: 'timer', md: 'timer-outline' },
  shield: { sf: 'checkmark.shield', md: 'shield-check' },
  link: { sf: 'link', md: 'link-variant' },
  copy: { sf: 'doc.on.doc', md: 'content-copy' },
  share: { sf: 'square.and.arrow.up', md: 'share-variant' },
  bolt: { sf: 'bolt', md: 'lightning-bolt' },
  block: { sf: 'nosign', md: 'cancel' },
  kick: { sf: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  logs: { sf: 'doc.text', md: 'text-box-outline' },
  services: { sf: 'square.stack.3d.up', md: 'layers-outline' },
  antenna: { sf: 'antenna.radiowaves.left.and.right', md: 'access-point' },
  transparency: { sf: 'square.on.square.dashed', md: 'blur' },
  demo: { sf: 'sparkles', md: 'creation' },
  about: { sf: 'info.circle', md: 'information-outline' },
  pin: { sf: 'pin', md: 'pin' },
  close: { sf: 'xmark', md: 'close' },
} as const satisfies Record<string, { sf: string; md: MdName }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: ColorValue }) {
  const icon = ICONS[name];
  if (Platform.OS === 'ios') {
    return <SymbolView name={icon.sf as SFSymbol} size={size} tintColor={color} type="monochrome" />;
  }
  return <MaterialCommunityIcons name={icon.md} size={size} color={color as string} />;
}
