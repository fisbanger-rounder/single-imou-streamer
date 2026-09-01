const $ = (sel) => document.querySelector(sel);

const el = {
  banner: $("#server-banner"),
  pill: $("#conn-pill"),
  gridShell: $("#grid-shell"),
  gridInfo: $("#grid-info"),
  streamInfo: $("#stream-info"),
  tabs: document.querySelectorAll(".tab"),
  cardPlayback: $("#card-playback"),
  btnConnect: $("#btn-connect"),
  btnDisconnect: $("#btn-disconnect"),
  btnStopAll: $("#btn-stop-all"),
  btnPlay: $("#btn-play"),
  btnPlayLabel: $("#btn-play-label"),
  btnSnap: $("#btn-snap"),
  btnRecord: $("#btn-record"),
  btnRecordLabel: $("#btn-record-label"),
  btnMute: $("#btn-mute"),
  btnMuteLabel: $("#btn-mute-label"),
  btnTalk: $("#btn-talk"),
  btnTalkLabel: $("#btn-talk-label"),
  btnFullscreen: $("#btn-fullscreen"),
  inDeviceId: $("#in-deviceId"),
  inChannelId: $("#in-channelId"),
  inCode: $("#in-code"),
  inStreamId: $("#in-streamId"),
  inRecordType: $("#in-recordType"),
  inBeginTime: $("#in-beginTime"),
  inEndTime: $("#in-endTime"),
  inSpeed: $("#in-speed"),
  ptzPad: $("#ptz-pad"),
  ptzDuration: $("#ptz-duration"),
  ptzDurationLabel: $("#ptz-duration-label"),
  log: $("#log"),
  btnClearLog: $("#btn-clear-log"),
  cameraList: $("#camera-list"),
  dlgHelp: $("#dlg-help"),
  btnHelp: $("#btn-help"),
};

const state = {
  mode: "live", // live | playback
  gridSize: 1, // 1 | 4 | 9 | 16
  tiles: [], // { cfg, player, status: empty|loading|live|error, error, paused, recording, muted, talking, dom }
  selected: 0,
  tileSize: { width: 640, height: 360 },
};

/* ---------------- helpers ---------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function win(i) {
  return `W${i + 1}`;
}

function labelFor(cfg) {
  if (!cfg) return "Empty";
  return `${cfg.deviceId} · Ch${cfg.channelId || 0}`;
}

function sel() {
  return state.tiles[state.selected] || null;
}

function log(message, level = "info") {
  const li = document.createElement("li");
  li.className = `lv-${level}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  li.appendChild(time);
  li.appendChild(document.createTextNode(message));
  el.log.prepend(li);
  while (el.log.children.length > 200) el.log.lastChild.remove();
}

function setPill(text, cls) {
  el.pill.textContent = text;
  el.pill.className = `pill ${cls}`;
}

function refreshPill() {
  const live = state.tiles.filter((t) => t.status === "live").length;
  const loading = state.tiles.some((t) => t.status === "loading");
  const s = sel();
  if (loading) setPill("Connecting", "pill-connecting");
  else if (s?.status === "error") setPill("Error", "pill-error");
  else if (live > 0) setPill(live === 1 ? "Live" : `${live} live`, "pill-live");
  else setPill("Idle", "pill-idle");
}

function refreshGridInfo() {
  const live = state.tiles.filter((t) => t.status === "live").length;
  el.gridInfo.textContent = `${state.gridSize} window${state.gridSize > 1 ? "s" : ""} · ${live} streaming`;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const PLAYER_ERRORS = {
  1001: "Decryption failed - check the encryption key field",
  1002: "Device response exception, please retry",
  2001: "Failed to get intercom address - check the device",
  2002: "Intercom connection failed - audio talk stream already exists",
  2003: "Device does not support video talk",
  2004: "Microphone is busy or permission denied",
  2005: "Camera is busy or permission denied",
  2006: "Intercom failure, try again later",
  2007: "Device hung up during the call",
  2008: "Intercom line busy",
  2009: "Intercom shut down",
};

/* ---------------- persistence ---------------- */

const SAVE_KEYS = ["deviceId", "channelId", "code", "streamId", "recordType"];
function saveSettings() {
  const data = {};
  for (const k of SAVE_KEYS) data[k] = el[`in${k[0].toUpperCase()}${k.slice(1)}`]?.value ?? "";
  localStorage.setItem("imou-viewer", JSON.stringify(data));
}
function restoreSettings() {
  try {
    const data = JSON.parse(localStorage.getItem("imou-viewer") || "{}");
    if (data.deviceId) el.inDeviceId.value = data.deviceId;
    if (data.channelId !== undefined && data.channelId !== "") el.inChannelId.value = data.channelId;
    if (data.code) el.inCode.value = data.code;
    if (data.streamId) el.inStreamId.value = data.streamId;
    if (data.recordType) el.inRecordType.value = data.recordType;
  } catch {
    /* ignore */
  }
}

function saveGrid() {
  localStorage.setItem(
    "imou-grid",
    JSON.stringify({
      gridSize: state.gridSize,
      selected: state.selected,
      tiles: state.tiles.map((t) => ({ cfg: t.cfg ? { ...t.cfg } : null })),
    })
  );
}

function restoreGridState() {
  try {
    const data = JSON.parse(localStorage.getItem("imou-grid") || "{}");
    if ([1, 4, 9, 16].includes(data.gridSize)) state.gridSize = data.gridSize;
    state.selected = Math.max(0, Math.min(state.gridSize - 1, Number(data.selected) || 0));
    state.tiles = (Array.isArray(data.tiles) ? data.tiles : []).slice(0, state.gridSize).map((t) => ({
      ...newTile(),
      cfg: t?.cfg && t.cfg.deviceId ? { ...t.cfg } : null,
    }));
  } catch {
    /* ignore */
  }
}

function loadCameras() {
  try {
    return JSON.parse(localStorage.getItem("imou-cameras") || "[]");
  } catch {
    return [];
  }
}
function saveCameras(list) {
  localStorage.setItem("imou-cameras", JSON.stringify(list.slice(0, 24)));
}
function rememberCamera(cfg) {
  const list = loadCameras();
  const key = (c) => `${c.deviceId}|${c.channelId}`;
  const filtered = list.filter((c) => key(c) !== key(cfg));
  filtered.unshift({ deviceId: cfg.deviceId, channelId: cfg.channelId });
  saveCameras(filtered);
  renderCameras();
}
function renderCameras() {
  const list = loadCameras();
  el.cameraList.innerHTML = "";
  if (!list.length) {
    const p = document.createElement("li");
    p.className = "camera-empty";
    p.textContent = "No cameras saved yet - connect one and it appears here.";
    el.cameraList.appendChild(p);
    return;
  }
  for (const cam of list) {
    const li = document.createElement("li");
    li.className = "camera-item";
    li.innerHTML = `
      <span class="cam-sn">${escapeHtml(cam.deviceId)}</span>
      <span class="cam-ch">Ch${escapeHtml(String(cam.channelId ?? 0))}</span>
      <button class="camera-remove" type="button" title="Forget this camera">&#10005;</button>`;
    li.addEventListener("click", () => assignCamera(cam));
    li.querySelector(".camera-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      saveCameras(loadCameras().filter((c) => c !== cam));
      renderCameras();
      log(`Forgot camera ${cam.deviceId}`);
    });
    el.cameraList.appendChild(li);
  }
}

async function assignCamera(cam) {
  el.inDeviceId.value = cam.deviceId;
  el.inChannelId.value = cam.channelId ?? 0;
  saveSettings();
  await startTile(state.selected, {
    deviceId: cam.deviceId,
    channelId: String(Number(cam.channelId) || 0),
    code: el.inCode.value.trim(),
    streamId: Number(el.inStreamId.value) || 0,
  });
}

/* ---------------- grid layout ---------------- */

function newTile() {
  return {
    cfg: null,
    player: null,
    status: "empty", // empty | loading | live | error
    error: "",
    paused: false,
    recording: false,
    muted: false,
    talking: false,
    autoPaused: false,
    dom: null,
  };
}

function colsFor(n) {
  return n === 1 ? 1 : n === 4 ? 2 : n === 9 ? 3 : 4;
}

function layoutGrid() {
  const cols = colsFor(state.gridSize);
  const rows = Math.ceil(state.gridSize / cols);
  const gap = 8;
  const availW = el.gridShell.clientWidth || el.gridShell.parentElement.clientWidth || 800;
  let tileW = (availW - gap * (cols - 1)) / cols;
  let tileH = (tileW * 9) / 16;
  const maxH = Math.max(300, window.innerHeight * 0.72);
  let shellH = tileH * rows + gap * (rows - 1);
  if (shellH > maxH) {
    const s = maxH / shellH;
    tileW *= s;
    shellH = maxH;
  }
  el.gridShell.style.gridTemplateColumns = `repeat(${cols}, ${Math.floor(tileW)}px)`;
  el.gridShell.style.height = `${Math.floor(shellH)}px`;
  state.tileSize = { width: Math.floor(tileW), height: Math.floor(tileH) };
}

function dotClass(t) {
  return `dot-${t.status === "live" && t.paused ? "paused" : t.status}`;
}

function renderTile(i) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.i = i;
  tile.innerHTML = `
    <div class="tile-head">
      <span class="tile-dot"></span>
      <span class="tile-name"></span>
      <button class="tile-close" type="button" title="Clear this window">&#10005;</button>
    </div>
    <div class="tile-body"><div class="tile-mount" id="tile-mount-${i}"></div></div>
    <div class="overlay ov-idle hidden"><p></p></div>
    <div class="overlay ov-loading hidden"><div class="spinner"></div><p>Connecting&hellip;</p></div>
    <div class="overlay overlay-error ov-error hidden"><div class="overlay-icon">&#9888;</div><p></p></div>`;
  tile.addEventListener("click", () => selectTile(i));
  tile.querySelector(".tile-close").addEventListener("click", (e) => {
    e.stopPropagation();
    clearTile(i);
  });

  const t = state.tiles[i];
  t.dom = {
    root: tile,
    dot: tile.querySelector(".tile-dot"),
    name: tile.querySelector(".tile-name"),
    ovIdle: tile.querySelector(".ov-idle"),
    ovLoading: tile.querySelector(".ov-loading"),
    ovError: tile.querySelector(".ov-error"),
    errText: tile.querySelector(".ov-error p"),
  };
  return tile;
}

function syncTilesDom() {
  while (state.tiles.length > state.gridSize) {
    const t = state.tiles.pop();
    destroyTilePlayer(t);
  }
  while (state.tiles.length < state.gridSize) state.tiles.push(newTile());

  while (el.gridShell.children.length > state.gridSize) el.gridShell.lastChild.remove();
  while (el.gridShell.children.length < state.gridSize) {
    el.gridShell.appendChild(renderTile(el.gridShell.children.length));
  }

  for (const b of document.querySelectorAll(".grid-btn")) {
    b.classList.toggle("active", Number(b.dataset.grid) === state.gridSize);
  }
  layoutGrid();
  refreshAllTiles();
  updateTransport();
  refreshGridInfo();
}

function refreshTileUi(i) {
  const t = state.tiles[i];
  if (!t?.dom) return;
  const d = t.dom;
  d.dot.className = `tile-dot ${dotClass(t)}`;
  d.name.textContent = t.cfg ? `${win(i)} · ${labelFor(t.cfg)}` : `${win(i)} · Empty`;
  d.root.classList.toggle("selected", i === state.selected);
  d.ovIdle.classList.toggle("hidden", !(t.status === "empty"));
  d.ovIdle.querySelector("p").innerHTML = t.cfg
    ? `<small>${escapeHtml(labelFor(t.cfg))}</small><br>Stopped &mdash; press <b>Connect</b> to resume`
    : `Empty window<br><small>Select it, then press <b>Connect</b></small>`;
  d.ovLoading.classList.toggle("hidden", t.status !== "loading");
  d.ovError.classList.toggle("hidden", t.status !== "error");
  if (t.status === "error") d.errText.textContent = t.error || "Error";
}

function refreshAllTiles() {
  state.tiles.forEach((_, i) => refreshTileUi(i));
}

function markSelected() {
  state.tiles.forEach((t, i) => t.dom?.root.classList.toggle("selected", i === state.selected));
  const t = sel();
  el.btnPlayLabel.innerHTML = t?.paused ? "&#9654; Resume" : "&#10074;&#10074; Pause";
  el.btnMuteLabel.innerHTML = t?.muted ? "&#128263; Muted" : "&#128266; Sound on";
  el.btnRecord.classList.toggle("recording", Boolean(t?.recording));
  el.btnRecordLabel.innerHTML = t?.recording ? "&#9632; Stop rec" : "&#9679; Record";
  updateTransport();
  refreshStreamInfo();
}

function selectTile(i) {
  if (state.selected === i) {
    markSelected();
    return;
  }
  stopTalk(true);
  state.selected = i;
  markSelected();
  refreshAllTiles();
  saveGrid();
  log(`Selected ${win(i)}${state.tiles[i].cfg ? ` · ${labelFor(state.tiles[i].cfg)}` : ""}`);
}

/* ---------------- player lifecycle ---------------- */

function destroyTilePlayer(t) {
  if (t._loadTimeout) { clearTimeout(t._loadTimeout); t._loadTimeout = null; }
  if (t.player) {
    try {
      t.player.destroy();
    } catch {
      /* ignore */
    }
    t.player = null;
  }
  const mount = t.dom?.root?.querySelector(".tile-mount");
  if (mount) {
    const fresh = document.createElement("div");
    fresh.className = "tile-mount";
    fresh.id = mount.id;
    mount.replaceWith(fresh);
  }
}

function controlsFor(mode) {
  return mode === "playback"
    ? ["play", "volume", "capture", "videoRecord", "speed", "recordChange", "recordTimeLine", "calendar", "fullScreen"]
    : ["play", "volume", "capture", "fullScreen"];
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function toImouTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function startTile(i, cfg) {
  const t = state.tiles[i];
  if (!t || !cfg?.deviceId) return;

  if (!/^[\w:-]{4,64}$/.test(cfg.deviceId)) {
    t.status = "error";
    t.error = "Invalid device SN (allowed: letters, digits, :, -, _; 4-64 chars)";
    refreshTileUi(i);
    refreshPill();
    log(`[${win(i)}] ${t.error}`, "err");
    return;
  }

  if (t.talking) stopTalk(true);

  destroyTilePlayer(t);
  t.cfg = { ...cfg };
  t.status = "loading";
  t.error = "";
  t.paused = false;
  t.recording = false;
  t.muted = state.gridSize > 1; // avoid audio chaos in multi-view
  refreshTileUi(i);
  refreshPill();
  refreshGridInfo();
  saveGrid();
  rememberCamera({ deviceId: cfg.deviceId, channelId: cfg.channelId });

  try {
    if (typeof window.imouPlayer !== "function") {
      throw new Error("imou-player.js failed to load - check browser console");
    }

    const tokenInfo = await api("/api/kit-token", {
      deviceId: cfg.deviceId,
      channelId: cfg.channelId || 0,
    });
    log(`[${win(i)}] kitToken acquired (${tokenInfo.cached ? "cached" : "fresh"}, expires in ${tokenInfo.expireTime}s)`);

    // fresh mount node so the SDK starts clean
    const oldMount = document.getElementById(`tile-mount-${i}`);
    const freshMount = document.createElement("div");
    freshMount.className = "tile-mount";
    freshMount.id = `tile-mount-${i}`;
    oldMount.replaceWith(freshMount);

    const isPlayback = state.mode === "playback";
    const options = {
      id: `tile-mount-${i}`,
      width: state.tileSize.width,
      height: state.tileSize.height,
      domain: (window.__imouConfig?.baseUrl || "").replace(/\/+$/, ""),
      deviceId: cfg.deviceId,
      channelId: Number(cfg.channelId) || 0,
      token: tokenInfo.kitToken,
      type: isPlayback ? 2 : 1,
      streamId: Number(cfg.streamId) || 0,
      muted: t.muted,
      code: cfg.code || "",
      WasmLibPath: "/",
      dpr: window.devicePixelRatio || 0,
      templateMode: "pc",
      threadMode: "singleThread",
      controls: true,
      controlsConfig: controlsFor(isPlayback ? "playback" : "live"),
      title: labelFor(cfg),
      handleError: (err) => {
        if (t._loadTimeout) { clearTimeout(t._loadTimeout); t._loadTimeout = null; }
        const msg = PLAYER_ERRORS[err?.errCode] || err?.errMsg || JSON.stringify(err);
        log(`[${win(i)}] Player error ${err?.errCode ?? ""}: ${msg}`, "err");
        t.status = "error";
        t.error = `${err?.errCode ?? ""} ${msg}`.trim();
        refreshTileUi(i);
        refreshPill();
        refreshGridInfo();
        updateTransport();
      },
      handleCallBack: (evt) => {
        if (evt?.type === "playStart") {
          if (t._loadTimeout) { clearTimeout(t._loadTimeout); t._loadTimeout = null; }
          t.paused = false;
          if (t.status !== "live") {
            t.status = "live";
            refreshTileUi(i);
            refreshGridInfo();
          }
          refreshPill();
          refreshStreamInfo();
          log(`[${win(i)}] Stream started`, "ok");
        } else if (evt?.type === "talkStart") {
          t.talking = true;
          el.btnTalk.classList.add("talking");
          el.btnTalkLabel.innerHTML = "&#127908; Talking&hellip;";
          log(`[${win(i)}] Two-way talk started`, "ok");
        } else if (evt?.type === "talkEnd") {
          endTalkUi();
          log(`[${win(i)}] Two-way talk ended`);
        }
      },
      handleStartTalk: () => {},
    };

    if (isPlayback) {
      options.recordType = el.inRecordType.value;
      const begin = el.inBeginTime.value ? new Date(el.inBeginTime.value) : new Date(Date.now() - 3600e3);
      const end = el.inEndTime.value ? new Date(el.inEndTime.value) : new Date();
      options.beginTime = toImouTime(begin);
      options.endTime = toImouTime(end);
    }

    t.player = new window.imouPlayer(options);
    // keep status as "loading" until handleCallBack playStart fires
    // set a safety timeout so a stalled SDK does not spin forever
    const loadTimeout = setTimeout(() => {
      if (t.status === "loading") {
        t.status = "error";
        t.error = "Stream timeout - no playStart from device (check device online, code, region, and browser console Network/WasmLib)";
        refreshTileUi(i);
        refreshPill();
        refreshGridInfo();
        updateTransport();
        log(`[${win(i)}] Timeout waiting for stream`, "err");
      }
    }, 15000);
    t._loadTimeout = loadTimeout;

    try {
      t.player.play();
    } catch {
      /* constructor may have auto-started */
    }
    refreshTileUi(i);
    refreshPill();
    refreshGridInfo();
    updateTransport();
    log(`[${win(i)}] Connecting to ${cfg.deviceId} (ch.${cfg.channelId || 0})${isPlayback ? " · playback" : ""}...`);
  } catch (err) {
    log(`[${win(i)}] ${err.message}`, "err");
    t.status = "error";
    t.error = err.message;
    destroyTilePlayer(t);
    refreshTileUi(i);
    refreshPill();
    refreshGridInfo();
    updateTransport();
  }
}

function connectSelected() {
  const deviceId = el.inDeviceId.value.trim();
  if (!deviceId) {
    el.inDeviceId.focus();
    return;
  }
  saveSettings();
  startTile(state.selected, {
    deviceId,
    channelId: String(Number(el.inChannelId.value) || 0),
    code: el.inCode.value.trim(),
    streamId: Number(el.inStreamId.value) || 0,
  });
}

function clearTile(i) {
  const t = state.tiles[i];
  if (!t) return;
  if (t.talking) stopTalk(true);
  if (t.recording) stopTileRecord(t);
  destroyTilePlayer(t);
  log(`[${win(i)}] Stopped${t.cfg ? ` (${labelFor(t.cfg)})` : ""}`);
  t.cfg = null;
  t.status = "empty";
  t.error = "";
  t.paused = false;
  t.recording = false;
  t.muted = false;
  refreshTileUi(i);
  refreshPill();
  refreshGridInfo();
  updateTransport();
  refreshStreamInfo();
  saveGrid();
}

function stopAll() {
  state.tiles.forEach((_, i) => clearTile(i));
  log("All windows stopped");
}

/* ---------------- transport (acts on selected window) ---------------- */

function updateTransport() {
  const t = sel();
  const hasStream = Boolean(t?.player) && (t.status === "live" || t.status === "loading");
  el.btnDisconnect.disabled = !t?.cfg;
  el.btnPlay.disabled = !(t?.player && t.status === "live");
  el.btnSnap.disabled = !hasStream;
  el.btnRecord.disabled = !hasStream;
  el.btnMute.disabled = !hasStream;
  el.btnTalk.disabled = !hasStream;
  el.btnFullscreen.disabled = !hasStream;
}

function refreshStreamInfo() {
  const t = sel();
  if (!t?.player || t.status !== "live") {
    el.streamInfo.textContent = "";
    return;
  }
  const q = state.mode === "live" ? `LIVE · ${Number(t.cfg?.streamId) === 1 ? "SD" : "HD"}` : "PLAYBACK";
  el.streamInfo.textContent = `${win(state.selected)} · ${labelFor(t.cfg)} · ${q}`;
}

function togglePlayPause() {
  const t = sel();
  if (!t?.player) return;
  if (t.paused) {
    t.player.start();
    t.paused = false;
    el.btnPlayLabel.innerHTML = "&#10074;&#10074; Pause";
    log(`[${win(state.selected)}] Resumed`);
  } else {
    t.player.pause();
    t.paused = true;
    el.btnPlayLabel.innerHTML = "&#9654; Resume";
    log(`[${win(state.selected)}] Paused`);
  }
  refreshAllTiles();
}

function capture() {
  const t = sel();
  t?.player?.capture();
  log(`[${win(state.selected)}] Screenshot saved`);
}

function stopTileRecord(t) {
  t.player?.stopRecord();
  t.recording = false;
  el.btnRecord.classList.remove("recording");
  el.btnRecordLabel.innerHTML = "&#9679; Record";
}

function toggleRecord() {
  const t = sel();
  if (!t?.player) return;
  if (t.recording) {
    stopTileRecord(t);
    log(`[${win(state.selected)}] Recording stopped, MP4 downloaded`);
  } else {
    t.player.startRecord();
    t.recording = true;
    el.btnRecord.classList.add("recording");
    el.btnRecordLabel.innerHTML = "&#9632; Stop rec";
    log(`[${win(state.selected)}] Recording started`);
  }
}

function toggleMute() {
  const t = sel();
  if (!t?.player) return;
  t.muted = !t.muted;
  t.player.volume(t.muted ? 0 : 1);
  el.btnMuteLabel.innerHTML = t.muted ? "&#128263; Muted" : "&#128266; Sound on";
}

let fullscreen = false;
function toggleFullscreen() {
  const t = sel();
  if (!t?.player) return;
  if (fullscreen) {
    t.player.exitFullScreen();
    fullscreen = false;
  } else {
    t.player.fullScreen();
    fullscreen = true;
  }
}

/* ---------------- two-way talk (selected window) ---------------- */

function endTalkUi() {
  for (const t of state.tiles) t.talking = false;
  el.btnTalk.classList.remove("talking");
  el.btnTalkLabel.innerHTML = "&#127908; Hold to talk";
}

function startTalk() {
  const t = sel();
  if (!t?.player || t.talking) return;
  try {
    t.player.startTalk();
  } catch (err) {
    log(`startTalk failed: ${err.message}`, "err");
  }
}
function stopTalk(silent = false) {
  const t = sel();
  if (!t?.player) {
    endTalkUi();
    return;
  }
  if (t.talking || !silent) {
    try {
      t.player.stopTalk();
    } catch {
      /* ignore */
    }
  }
  endTalkUi();
}

/* ---------------- PTZ (selected window) ---------------- */

const PTZ_HOLD_INTERVAL = 260;

async function ptzSend(operation, duration) {
  const cfg = sel()?.cfg;
  if (!cfg) {
    log("PTZ: no camera in the selected window", "warn");
    return;
  }
  try {
    await api("/api/ptz", {
      deviceId: cfg.deviceId,
      channelId: cfg.channelId || 0,
      operation,
      duration,
    });
    log(`PTZ [${win(state.selected)}] op=${operation} dur=${duration}ms`);
  } catch (err) {
    log(`PTZ failed: ${err.message}`, "warn");
  }
}

function setupPtz() {
  el.ptzDuration.addEventListener("input", () => {
    el.ptzDurationLabel.textContent = el.ptzDuration.value;
  });

  for (const btn of el.ptzPad.querySelectorAll(".ptz-btn")) {
    const op = Number(btn.dataset.op);
    let holdTimer = null;

    const beginHold = (event) => {
      event.preventDefault();
      if (!sel()?.cfg) return;
      btn.setPointerCapture?.(event.pointerId);
      btn.classList.add("holding");
      const duration = Number(el.ptzDuration.value);
      if (op === 10) {
        ptzSend(10, duration);
        return;
      }
      ptzSend(op, duration);
      holdTimer = setInterval(() => ptzSend(op, duration), Math.max(140, duration * 0.7));
    };
    const endHold = () => {
      if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = null;
      }
      btn.classList.remove("holding");
      if (op !== 10 && sel()?.cfg) ptzSend(10, 200);
    };

    btn.addEventListener("pointerdown", beginHold);
    btn.addEventListener("pointerup", endHold);
    btn.addEventListener("pointercancel", endHold);
    btn.addEventListener("lostpointercapture", endHold);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

/* ---------------- mode switching ---------------- */

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  for (const tab of el.tabs) tab.classList.toggle("active", tab.dataset.mode === mode);
  el.cardPlayback.hidden = mode !== "playback";

  if (mode === "playback") {
    if (!el.inBeginTime.value) el.inBeginTime.value = localIso(new Date(Date.now() - 3600e3));
    if (!el.inEndTime.value) el.inEndTime.value = localIso(new Date());
  }

  log(`Mode switched to ${mode}`);
  const t = sel();
  if (t?.cfg) startTile(state.selected, t.cfg);
}

function localIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------------- init ---------------- */

let _restoringSession = false;
function restoreSession() {
  if (_restoringSession) return;
  const queued = [];
  state.tiles.forEach((t, i) => {
    if (t.cfg?.deviceId && t.status !== "loading" && t.status !== "live") {
      queued.push([i, { ...t.cfg }]);
    }
  });
  if (!queued.length) return;
  _restoringSession = true;
  log(`Restoring last session: ${queued.length} camera${queued.length > 1 ? "s" : ""}`);
  // Defer until after the browser has painted the page so WASM init doesn't block the main thread.
  requestAnimationFrame(() => {
    queued.forEach(([i, cfg], n) => setTimeout(() => startTile(i, cfg), n * 350));
    _restoringSession = false;
  });
}

async function init() {
  restoreSettings();
  restoreGridState();

  el.btnConnect.addEventListener("click", connectSelected);
  for (const input of [el.inDeviceId, el.inChannelId, el.inCode]) {
    input.addEventListener("keydown", (e) => e.key === "Enter" && connectSelected());
  }
  el.btnDisconnect.addEventListener("click", () => clearTile(state.selected));
  el.btnStopAll.addEventListener("click", stopAll);
  el.btnPlay.addEventListener("click", togglePlayPause);
  el.btnSnap.addEventListener("click", capture);
  el.btnRecord.addEventListener("click", toggleRecord);
  el.btnMute.addEventListener("click", toggleMute);
  el.btnFullscreen.addEventListener("click", toggleFullscreen);

  for (const b of document.querySelectorAll(".grid-btn")) {
    b.addEventListener("click", () => {
      const n = Number(b.dataset.grid);
      if (n === state.gridSize) return;
      state.gridSize = n;
      if (state.selected >= n) state.selected = n - 1;
      syncTilesDom();
      refreshAllTiles();
      refreshPill();
      saveGrid();
      log(`Layout: ${n} window${n > 1 ? "s" : ""}`);
    });
  }

  // push-to-talk
  el.btnTalk.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startTalk();
  });
  const releaseTalk = () => state.tiles.some((t) => t.talking) && stopTalk();
  el.btnTalk.addEventListener("pointerup", releaseTalk);
  el.btnTalk.addEventListener("pointerleave", releaseTalk);
  el.btnTalk.addEventListener("pointercancel", releaseTalk);

  for (const tab of el.tabs) tab.addEventListener("click", () => switchMode(tab.dataset.mode));

  el.inSpeed.addEventListener("change", () => {
    const t = sel();
    if (t?.player && state.mode === "playback") {
      t.player.setSpeed(Number(el.inSpeed.value));
      log(`Speed set to ${el.inSpeed.value}x`);
    }
  });

  el.btnClearLog.addEventListener("click", () => (el.log.innerHTML = ""));
  el.btnHelp.addEventListener("click", () => el.dlgHelp.showModal());

  setupPtz();
  renderCameras();
  syncTilesDom();
  refreshPill();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layoutGrid();
      const { width, height } = state.tileSize;
      for (const t of state.tiles) {
        try {
          t.player?.resize?.(width, height);
        } catch {
          /* ignore */
        }
      }
    }, 150);
  });

  document.addEventListener("visibilitychange", () => {
    for (const t of state.tiles) {
      if (!t.player || t.status !== "live") continue;
      if (document.hidden && !t.paused) {
        t.player.pause();
        t.paused = true;
        t.autoPaused = true;
      } else if (!document.hidden && t.autoPaused) {
        t.player.start();
        t.paused = false;
        t.autoPaused = false;
      }
    }
  });

  try {
    const config = await api("/api/config");
    window.__imouConfig = config;
    if (!config.configured) {
      el.banner.classList.remove("hidden");
      el.banner.innerHTML =
        "Server is not configured: set <b>IMOU_APP_ID</b> / <b>IMOU_APP_SECRET</b> (or <b>IMOU_ACCESS_TOKEN</b>) in <code>.env</code> and restart. Click <b>?</b> for help.";
      log("Server credentials missing (.env)", "warn");
    } else {
      log(`Server ready · region API: ${config.baseUrl}${config.usingStaticToken ? " (static accessToken)" : ""}`);
      restoreSession();
    }
  } catch (err) {
    log(`Config check failed: ${err.message}`, "err");
  }
}

init();
