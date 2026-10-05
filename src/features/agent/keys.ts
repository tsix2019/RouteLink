/**
 * Public key of the plugin's apk packages (openwrt/feed/keys/routelink-apk.pem; a test keeps the two equal).
 * apk on OpenWrt 25.12 only installs local packages signed by a key in /etc/apk/keys.
 */
export const ROUTELINK_APK_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEERv6c8VMio1jE3V/05blWjSzHmI+
HUzZrWNq0l6pvxaq/fEBi5tkb7/C4dMhCow9BRKrwegO+T/jMkcAgWXkew==
-----END PUBLIC KEY-----
`;
