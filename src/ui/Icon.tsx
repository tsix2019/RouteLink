import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';

type IonName = ComponentProps<typeof Ionicons>['name'];
type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * One name per concept: SF Symbol on iOS; elsewhere Ionicons (closest to SF Symbols, keeping the iOS 26
 * look on Android) with Material Community icons only where Ionicons has no equivalent.
 */
export const ICONS = {
  overview: { sf: 'gauge.with.dots.needle.67percent', ion: 'speedometer-outline' },
  devices: { sf: 'laptopcomputer.and.iphone', ion: 'laptop-outline' },
  wifi: { sf: 'wifi', ion: 'wifi' },
  wifiOff: { sf: 'wifi.slash', mci: 'wifi-off' },
  network: { sf: 'network', ion: 'git-network-outline' },
  more: { sf: 'ellipsis.circle', ion: 'ellipsis-horizontal-circle-outline' },
  router: { sf: 'wifi.router', mci: 'router-wireless' },
  chevronRight: { sf: 'chevron.right', ion: 'chevron-forward' },
  chevronLeft: { sf: 'chevron.left', ion: 'chevron-back' },
  chevronDown: { sf: 'chevron.down', ion: 'chevron-down' },
  check: { sf: 'checkmark', ion: 'checkmark' },
  plus: { sf: 'plus', ion: 'add' },
  refresh: { sf: 'arrow.clockwise', ion: 'refresh' },
  power: { sf: 'power', ion: 'power' },
  cpu: { sf: 'cpu', ion: 'hardware-chip-outline' },
  memory: { sf: 'memorychip', mci: 'memory' },
  storage: { sf: 'internaldrive', mci: 'harddisk' },
  temperature: { sf: 'thermometer.medium', ion: 'thermometer-outline' },
  globe: { sf: 'globe', ion: 'globe-outline' },
  down: { sf: 'arrow.down', ion: 'arrow-down' },
  up: { sf: 'arrow.up', ion: 'arrow-up' },
  phone: { sf: 'iphone', ion: 'phone-portrait-outline' },
  laptop: { sf: 'laptopcomputer', ion: 'laptop-outline' },
  desktop: { sf: 'desktopcomputer', ion: 'desktop-outline' },
  tablet: { sf: 'ipad', ion: 'tablet-portrait-outline' },
  tv: { sf: 'tv', ion: 'tv-outline' },
  printer: { sf: 'printer', ion: 'print-outline' },
  game: { sf: 'gamecontroller', ion: 'game-controller-outline' },
  camera: { sf: 'web.camera', ion: 'videocam-outline' },
  speaker: { sf: 'hifispeaker', mci: 'speaker' },
  plug: { sf: 'powerplug', mci: 'power-plug-outline' },
  server: { sf: 'server.rack', ion: 'server-outline' },
  unknownDevice: { sf: 'questionmark.circle', ion: 'help-circle-outline' },
  ethernet: { sf: 'cable.connector', mci: 'ethernet' },
  lock: { sf: 'lock.fill', ion: 'lock-closed' },
  lockOpen: { sf: 'lock.open', ion: 'lock-open-outline' },
  eye: { sf: 'eye', ion: 'eye-outline' },
  eyeOff: { sf: 'eye.slash', ion: 'eye-off-outline' },
  search: { sf: 'magnifyingglass', ion: 'search' },
  trash: { sf: 'trash', ion: 'trash-outline' },
  edit: { sf: 'pencil', ion: 'pencil' },
  scan: { sf: 'dot.radiowaves.left.and.right', ion: 'radio-outline' },
  info: { sf: 'info.circle', ion: 'information-circle-outline' },
  warning: { sf: 'exclamationmark.triangle', ion: 'warning-outline' },
  error: { sf: 'exclamationmark.octagon', ion: 'alert-circle' },
  settings: { sf: 'gearshape', ion: 'settings-outline' },
  language: { sf: 'character.bubble', ion: 'language-outline' },
  appearance: { sf: 'circle.lefthalf.filled', ion: 'contrast-outline' },
  timer: { sf: 'timer', ion: 'timer-outline' },
  shield: { sf: 'checkmark.shield', ion: 'shield-checkmark-outline' },
  link: { sf: 'link', ion: 'link-outline' },
  copy: { sf: 'doc.on.doc', ion: 'copy-outline' },
  share: { sf: 'square.and.arrow.up', ion: 'share-outline' },
  bolt: { sf: 'bolt', ion: 'flash-outline' },
  block: { sf: 'nosign', ion: 'ban-outline' },
  kick: { sf: 'rectangle.portrait.and.arrow.right', ion: 'log-out-outline' },
  logs: { sf: 'doc.text', ion: 'document-text-outline' },
  services: { sf: 'square.stack.3d.up', ion: 'layers-outline' },
  antenna: { sf: 'antenna.radiowaves.left.and.right', ion: 'radio-outline' },
  transparency: { sf: 'square.on.square.dashed', ion: 'color-filter-outline' },
  demo: { sf: 'sparkles', ion: 'sparkles-outline' },
  about: { sf: 'info.circle', ion: 'information-circle-outline' },
  pin: { sf: 'pin', ion: 'pin-outline' },
  close: { sf: 'xmark', ion: 'close' },
  stop: { sf: 'stop.fill', ion: 'stop' },
  plugin: { sf: 'puzzlepiece.extension', ion: 'extension-puzzle-outline' },
  chart: { sf: 'chart.bar.xaxis', ion: 'bar-chart-outline' },
  calendar: { sf: 'calendar', ion: 'calendar-outline' },
  pulse: { sf: 'waveform.path.ecg', ion: 'pulse-outline' },
  download: { sf: 'arrow.down.circle', ion: 'download-outline' },
  qrcode: { sf: 'qrcode', ion: 'qr-code-outline' },
  route: { sf: 'arrow.triangle.branch', ion: 'git-branch-outline' },
  connections: { sf: 'arrow.left.arrow.right', ion: 'swap-horizontal-outline' },
  firewall: { sf: 'shield.lefthalf.filled', ion: 'shield-half-outline' },
  vpn: { sf: 'lock.shield', ion: 'shield-outline' },
  process: { sf: 'list.bullet.rectangle', ion: 'list-outline' },
  package: { sf: 'shippingbox', ion: 'cube-outline' },
  schedule: { sf: 'clock.arrow.circlepath', ion: 'time-outline' },
  light: { sf: 'lightbulb', ion: 'bulb-outline' },
  key: { sf: 'key', ion: 'key-outline' },
  guest: { sf: 'person.2', ion: 'people-outline' },
  filter: { sf: 'line.3.horizontal.decrease.circle', ion: 'filter-outline' },
  hourglass: { sf: 'hourglass', ion: 'hourglass-outline' },
  moon: { sf: 'moon', ion: 'moon-outline' },
  vlan: { sf: 'square.grid.3x3', ion: 'grid-outline' },
  speed: { sf: 'speedometer', ion: 'speedometer-outline' },
  adblock: { sf: 'hand.raised', ion: 'hand-left-outline' },
  backup: { sf: 'archivebox', ion: 'archive-outline' },
  firmware: { sf: 'arrow.up.circle', ion: 'arrow-up-circle-outline' },
  reset: { sf: 'arrow.counterclockwise.circle', ion: 'refresh-circle-outline' },
  import: { sf: 'doc.badge.plus', ion: 'document-attach-outline' },
  terminal: { sf: 'apple.terminal', ion: 'terminal-outline' },
  paste: { sf: 'doc.on.clipboard', ion: 'clipboard-outline' },
  textSize: { sf: 'textformat.size', ion: 'text-outline' },
  assistant: { sf: 'bubble.left.and.text.bubble.right', ion: 'chatbubbles-outline' },
  send: { sf: 'arrow.up', ion: 'arrow-up' },
  bell: { sf: 'bell', ion: 'notifications-outline' },
  widget: { sf: 'square.grid.2x2', ion: 'grid-outline' },
} as const satisfies Record<string, { sf: string; ion: IonName } | { sf: string; mci: MciName }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: ColorValue }) {
  const icon: { sf: string; ion?: IonName; mci?: MciName } = ICONS[name];
  if (Platform.OS === 'ios') {
    return <SymbolView name={icon.sf as SFSymbol} size={size} tintColor={color} type="monochrome" />;
  }
  if (icon.ion) return <Ionicons name={icon.ion} size={size} color={color as string} />;
  return <MaterialCommunityIcons name={icon.mci!} size={size} color={color as string} />;
}
