/** A peer's config page (QR code and file): `iface` and its public key pick the peer. */
export const wgExportHref = (iface: string, publicKey: string) =>
  `/network/wireguard-export?iface=${encodeURIComponent(iface)}&key=${encodeURIComponent(publicKey)}` as const;
