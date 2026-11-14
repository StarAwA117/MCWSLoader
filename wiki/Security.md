# Security

MCWSLoader is usually deployed on a trusted machine or LAN. These layers keep
the WebUI and the game bridge from being controlled by random network clients.

## WebUI authentication

- Login is only `POST /api/login` with `{ "password": "..." }`; passwords never
  appear in URLs or access logs
- Passwords are hashed with scrypt and compared in constant time
- Failed attempts are counted per IP and locked out
- Sessions are random 32-byte tokens, sent as `X-Auth-Token`
- `POST /api/logout` destroys the current session server-side
- Changing the password invalidates **all** sessions

Output escaping, CSP and `v-html` usage are kept in mind: Mod README rendering
escapes text and only allows safe URL schemes.

## HTTP headers

The WebUI serves HTML with:

- `Content-Security-Policy` (`script-src 'self'`, no inline scripts)
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` disabling camera/microphone/geolocation
- `Cache-Control: no-store` for API responses and HTML

Cross-origin API access is disabled by default. Add explicit origins in
`web.ui.allowedOrigins` if another origin must call the API.

## WebSocket clients

Vanilla MCBE `/connect host:port` **cannot send tokens, custom headers or query
parameters**, so a real handshake authentication is impossible. MCWSLoader uses
practical substitutes:

1. **Bind to loopback by default** (`ws.host: "127.0.0.1"`)
2. **Browser Origin check** — browser connections are rejected unless the origin
   is listed in `web.ui.allowedOrigins`; native game clients send no Origin
3. **IP / CIDR allowlist** — `ws.connection.allowedIPs`, e.g.
   `["192.168.1.0/24"]`. Connections outside the list are closed with 1008
4. **Manual approval** — with `ws.connection.requireApproval` (default `true`),
   non-loopback clients start pending. Every incoming packet is dropped, SAPI
   polling is paused, and the client cannot become main until an authenticated
   admin clicks **Approve** on the WebUI Clients page. Loopback is auto-trusted
5. **Transport limits** — connection rate limit, max connections and an 8MB
   payload cap

The WebUI exposes:

- `GET /api/clients` — includes `trusted`
- `POST /api/clients/:id/approve`
- `POST /api/clients/:id/revoke`

## Mods and file imports

- Mod archives are validated before extraction: absolute paths, `..` entries
  (zip-slip) and excessive entry counts are rejected
- Symlinks and extraction size/count limits are enforced after extraction
- Unpacked size is capped at 256MB and 5000 entries
- `manifest.json` `entry` paths must be relative and inside the Mod directory
- npm dependencies are installed with `--ignore-scripts --no-package-lock`, so a
  package postinstall script cannot run arbitrary code
- Mods are still arbitrary Node.js code once loaded; only install trusted Mods

## Destructive commands

`t:exec` runs a server shell command and is **disabled by default**
(`command.allowShellExec: false`). Enable it only when the owner account is
fully trusted; it bypasses all other command sandboxing.

## Deployment recommendations

- Keep `ws.host` at `127.0.0.1` unless LAN clients are required
- If the WebUI is exposed beyond localhost, use HTTPS (reverse proxy) or a VPN
  such as WireGuard/Tailscale; HTTP transmits the password and session token in
  clear text
- Never expose the WebSocket port 8080 to the public internet
- Keep `requireApproval` enabled and/or restrict `allowedIPs` on shared LANs
