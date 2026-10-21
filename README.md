<div align="center">

<img src="public/icon.svg" width="88" height="88" alt="SixDrop" />

# SixDrop

**Browser-to-browser file transfer with a 6-digit pickup code.**

No install. No account. Files never touch the server.

[**sixdrop.dev**](https://sixdrop.dev) · [中文说明](README.zh.md)

</div>

---

## What it is

Two people open the same web page. Each one immediately gets a 6-digit code; the first screen holds nothing but that code and a box for typing the other side's code. Once someone types it in, both sides land in the same room, with two tabs: **Files** and **Text**. The two browsers connect **directly** over a WebRTC DataChannel and the bytes flow peer-to-peer — Cloudflare only relays the SDP handshake and ICE candidates.

```
 sender                          Cloudflare                    receiver
   |                                  |                            |
   | 1. POST /api/room  ------------->|                            |
   |<-------------  6-digit code      |                            |
   |                                  |<---- 2. type the code -----|
   | 3. SDP offer ------------------->|--------------------------->|
   |<------------------- SDP answer --|<---------------------------|
   |                                  |                            |
   |<========== WebRTC DataChannel (DTLS encrypted) ==============>|
   |         files and text, peer-to-peer, no server                |
```

## Features

- **6-digit pickup code** — no links to copy, no accounts, no email
- **Landing page is just the code** — your code plus a box to type the other side's code; everything else happens inside the room
- **Multi-file transfer** — pick a folder on the receiving side and everything lands there
- **Text messages too** — the room has a *Files* tab and a *Text* tab; switch whenever you like
- **One room, start to finish** — the code is handed out once; send another batch without a new code
- **Transfer verification code** — both sides see a short fingerprint of the DTLS certificate, so a MITM cannot silently swap the connection
- **Explicit failure** — if NAT traversal fails you get a diagnostic instead of a silent hang: candidate types (host / srflx / relay) and a plain-language hint
- **R2 fallback, opt-in** — when both peers sit behind symmetric NAT, the sender can park the files in Cloudflare R2 with 24-hour auto-delete and share a link instead
- **Delete after receive** — one click, no waiting for the TTL

## How it works

| Layer | Choice |
|---|---|
| Signalling | Cloudflare Worker + Durable Object per room, WebSocket, no message persistence |
| Transport | WebRTC DataChannel, ordered, DTLS-encrypted |
| Chunking | 256 KiB slices, clamped to `pc.sctp.maxMessageSize`, backpressure at 8 MiB `bufferedAmount` |
| Disk writes | `FileSystemAccess` streaming for Chrome/Edge, in-memory Blob fallback for Firefox/Safari |
| STUN | Public servers only — **no TURN**, deliberately |
| Fallback storage | Cloudflare R2, presigned PUT/GET, lifecycle rule deletes after 24 h |

There is no TURN server on purpose. Relaying media through a server costs money and defeats the point; when hole punching fails the app says so and offers the R2 path instead.

## Self-hosting

```bash
git clone https://github.com/<you>/sixdrop.git
cd sixdrop
npm install
npx wrangler deploy
```

`wrangler.jsonc` needs a domain or a `workers.dev` subdomain. Durable Objects are SQLite-backed and work on the free plan.

To enable the R2 fallback, create a bucket and set four secrets:

```bash
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Without them the app still works — the fallback button simply does not appear.

## Tests

```bash
npm test          # unit tests (Node only, no wrangler account needed)
npm run test:e2e  # three files end-to-end through two headless browsers, SHA-256 checked
```

## Status

Early but stable. Known limits: no resume after a dropped connection, and Firefox/Safari buffer received files in memory (keep single files under ~1 GB there).

## License

**No license is granted.**

The source is public for reading and learning from, but it is *not* open source: without a license you may not copy, modify, redistribute, or use it commercially. If you want to do any of those, open an issue and ask.
