import type { ToolCall } from '@/ai/types';
import type { Client } from '@/api/services/clients';
import type { AppT } from '@/i18n';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The confirmation card's sentence for a write the AI asked for, with devices named as the app shows them. */
export function describeCall(
  t: AppT,
  call: ToolCall,
  refs: Record<string, string>,
  clients: Client[] | undefined,
): string {
  const input = call.input;
  const device = () => {
    const code = str(input.device);
    const mac = refs[code.toLowerCase()];
    const client = mac ? clients?.find((c) => c.mac.toUpperCase() === mac) : undefined;
    return client?.name ?? t('assistant:confirm.device', { code });
  };
  switch (call.name) {
    case 'reboot_router':
      return t('assistant:confirm.reboot_router');
    case 'kick_device':
      return t('assistant:confirm.kick_device', { device: device() });
    case 'block_device':
      return input.block === false
        ? t('assistant:confirm.unblock_device', { device: device() })
        : t('assistant:confirm.block_device', { device: device() });
    case 'set_wifi': {
      const changes = [
        typeof input.enabled === 'boolean'
          ? t(input.enabled ? 'assistant:confirm.set_wifi_on' : 'assistant:confirm.set_wifi_off')
          : null,
        str(input.new_ssid) ? t('assistant:confirm.set_wifi_rename', { name: str(input.new_ssid) }) : null,
        str(input.new_password) ? t('assistant:confirm.set_wifi_password') : null,
      ].filter(Boolean);
      return t('assistant:confirm.set_wifi', { ssid: str(input.ssid), changes: changes.join(t('listSeparator')) });
    }
    case 'set_radio':
      return t(input.enabled === false ? 'assistant:confirm.set_radio_off' : 'assistant:confirm.set_radio_on', {
        radio: str(input.radio),
      });
    case 'add_port_forward':
      return t('assistant:confirm.add_port_forward', {
        name: str(input.name),
        port: str(input.external_port),
        protocol: str(input.protocol) || 'tcp',
        device: device(),
      });
    case 'remove_port_forward':
      return t('assistant:confirm.remove_port_forward', { name: str(input.name) });
    case 'restart_service':
      return t('assistant:confirm.restart_service', { name: str(input.name) });
    default:
      return t('assistant:confirm.unknown', { name: call.name });
  }
}
