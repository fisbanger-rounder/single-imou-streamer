import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ImouApiError, ImouClient, ImouConfigError } from "./lib/imou-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.IMOU_BASE_URL || "https://openapi-fk.easy4ip.com:443";

let client;
try {
  client = new ImouClient({
    appId: process.env.IMOU_APP_ID,
    appSecret: process.env.IMOU_APP_SECRET,
    baseUrl: BASE_URL,
    accessToken: process.env.IMOU_ACCESS_TOKEN || "",
  });
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

// Required for the player's multi-threaded WASM decoder (SharedArrayBuffer).
// Only for document/static resources - API responses don't need COEP and
// setting require-corp on API can break some fetch clients.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    // WASM/assets need CORP so COEP does not block them
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
  next();
});

app.get("/api/config", (req, res) => {
  res.json({
    baseUrl: BASE_URL,
    configured: Boolean(client.appId || client.staticAccessToken),
    usingStaticToken: Boolean(process.env.IMOU_ACCESS_TOKEN),
  });
});

app.post("/api/kit-token", async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const channelId = String(req.body?.channelId ?? "0").trim() || "0";
    if (!/^[\w:-]{4,64}$/.test(deviceId)) {
      return res.status(400).json({ error: "Invalid or missing deviceId" });
    }
    // type 0 = all permissions (live + playback + PTZ + talk)
    const result = await client.getKitToken(deviceId, channelId, "0");
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/api/devices", async (req, res, next) => {
  try {
    const result = await client.listDevices();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/api/ptz", async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const channelId = String(req.body?.channelId ?? "0").trim() || "0";
    const operation = Number(req.body?.operation);
    const duration = Number(req.body?.duration) || 500;
    if (!deviceId) {
      return res.status(400).json({ error: "Missing deviceId" });
    }
    if (!Number.isInteger(operation) || operation < 0 || operation > 10) {
      return res.status(400).json({ error: "operation must be an integer 0-10" });
    }
    res.json(await client.ptzControl(deviceId, channelId, operation, duration));
  } catch (err) {
    next(err);
  }
});

app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ImouConfigError ? 500 : err instanceof ImouApiError ? 502 : 500;
  console.error(`[error] ${err.message}`);
  res.status(status).json({ error: err.message, code: err.code });
});

const servers = [];
servers.push(http.createServer(app).listen(PORT, () => {
  console.log(`Imou CCTV streamer running at  http://localhost:${PORT}`);
}));

const tlsCert = process.env.TLS_CERT && path.resolve(process.env.TLS_CERT);
const tlsKey = process.env.TLS_KEY && path.resolve(process.env.TLS_KEY);
if (tlsCert && tlsKey && fs.existsSync(tlsCert) && fs.existsSync(tlsKey)) {
  https
    .createServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, app)
    .listen(PORT + 1, () => {
      console.log(`HTTPS (mic/talk ready) at  https://localhost:${PORT + 1}`);
    });
} else {
  console.log("[hint] Two-way talk requires a secure context. localhost is fine; for LAN access set TLS_CERT/TLS_KEY.");
}
