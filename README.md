# Imou CCTV Streaming Viewer

Web app for Imou cameras built on the official **Imou light-app player SDK** (vendored in `imou-player-SDK/` and served from `public/`):

- **Live view** — H.264/H.265 plug-in-free playback in the browser, HD/SD switching
- **Playback** — cloud recording, SD-card (local) recording and NVR disk, with timeline/calendar/speed controls
- **PTZ control** — hold-to-move directional pad + zoom via the `controlMovePTZ` Open Platform API
- **Two-way talk** — push-to-talk from the browser mic (secure context required)
- **Extras** — snapshot, screen recording (MP4 download), digital zoom, fullscreen, event log

```
┌────────────┐  /api/kit-token   ┌──────────────┐   signed HTTPS    ┌──────────────────────┐
│  Browser   │ ────────────────▶ │  Node server │ ────────────────▶ │ Imou Open Platform   │
│ (player +  │ ◀──────────────── │  (Express)   │ ◀──────────────── │ openapi-*.easy4ip.com│
│  WASM dec) │   Kt_... token    └──────────────┘   At_.../Kt_...     └──────────────────────┘
└────────────┘                                                        ▲
        │  WebSocket/WebRTC media + talk + PTZ joystick (SDK built-in) │ controlMovePTZ (custom pad)
        └──────────────────────────────────────────────────────────────┘ (via server)
```

The **appSecret never reaches the browser** — the Node backend signs all Open Platform calls and hands out short-lived `kitToken`s only.

---

## Requirements

- Node.js ≥ 18
- An [Imou Open Platform](https://open.imoulife.com) account (international) or [open.imou.com](https://open.imou.com) (China)
- Your camera bound to that account (device serial + verification code from the label)

## Setup

1. **Install & configure**

   ```bash
   npm install
   cp .env.example .env      # then edit .env
   ```

   In `.env` fill in:

   | Variable | Where to get it |
   |---|---|
   | `IMOU_APP_ID` / `IMOU_APP_SECRET` | Console → *My App* → App Information |
   | `IMOU_ACCESS_TOKEN` | Optional. Leave empty and the server fetches/caches one using appId+appSecret |
   | `IMOU_BASE_URL` | Must match your account's data center (see table below) |

   | Data center | Base URL |
   |---|---|
   | East Asia (Singapore) | `https://openapi-sg.easy4ip.com:443` |
   | Central Europe (Frankfurt) | `https://openapi-fk.easy4ip.com:443` |
   | Western America (Oregon) | `https://openapi-or.easy4ip.com:443` |
   | Mainland China | `https://openapi.lechange.cn` |

2. **Run**

   ```bash
   npm start            # http://localhost:3000
   # or: npm run dev    (auto-restart on changes)
   ```

3. **Connect** — enter your device SN, channel (usually `0`), optionally the encryption key if you enabled video encryption (or your device password), then press **Connect**.

### Two-way talk from other machines

Browsers only grant microphone access on secure origins (`localhost` counts). For LAN access drop a cert/key into `./certs/` and set `TLS_CERT`/`TLS_KEY` in `.env` — an HTTPS listener starts automatically on port `PORT + 1`.

## Usage notes

- **Live** tab streams instantly; switch quality HD/SD any time.
- **Playback** tab lets you pick record source and time range; use the in-player timeline/calendar to scrub, and the speed selector for 0.5×–32×.
- **PTZ** pad sends `controlMovePTZ` commands through the server — press and *hold* for continuous movement; release sends stop. Requires a pan/tilt model (e.g. Ranger series).
- The player's own toolbar (play, volume, talk, capture, PTZ joystick, resolution, zoom…) stays enabled alongside the custom controls; both drive the same stream.
- kitTokens are requested with full permissions (`type=0`) and cached ~1 h of their 2 h TTL.

## API endpoints

| Route | Body | Purpose |
|---|---|---|
| `GET /api/config` | – | Server config status + region base URL |
| `POST /api/kit-token` | `{deviceId, channelId}` | Signed `getKitToken` call (cached) |
| `POST /api/ptz` | `{deviceId, channelId, operation 0–10, duration ms}` | `controlMovePTZ`: 0 up · 1 down · 2 left · 3 right · 4↖ · 5↙ · 6↗ · 7↘ · 8 zoom-in · 9 zoom-out · 10 stop |

## Project layout

```
server.js               Express server (COOP/COEP headers, API proxy, static hosting)
lib/imou-client.js      OpenAPI client: HMAC-SHA256 signing, accessToken/kitToken cache, PTZ
public/
  index.html            UI (live/playback tabs, device form, PTZ pad, talk button)
  style.css             Dark console theme
  app.js                Player lifecycle, transport, talk, PTZ logic
  imou-player.js/css    Vendored Imou light-app SDK v1.3.8
  WasmLib/              WASM decoder (multi/single thread) — required by the SDK
imou-player-SDK/        Original SDK package kept for reference
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page / wasm errors | Check `WasmLib/` is reachable at `/WasmLib/`; see browser console |
| `SN1005` errors | Nonce replay — ensure server clock is NTP-synced |
| Wrong region / empty results | `IMOU_BASE_URL` must match where your app was created |
| Talk does nothing off-localhost | Serve over HTTPS (`TLS_CERT`/`TLS_KEY`) and allow the microphone |
| PTZ fails | Device needs pan/tilt capability; check it works in the Imou Life app first |
| Playback empty | No recordings in range/source; try Cloud vs Local, widen the window |

API quota note: each App ID has a monthly free request quota — the server caches tokens to keep usage minimal.
