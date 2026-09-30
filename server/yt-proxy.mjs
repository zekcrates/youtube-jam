import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Innertube, Platform } from 'youtubei.js';

// What's wrong with direct browser use (why this proxy exists):
// 1. youtubei.js needs to run YouTube's obfuscated player JS to decipher
//    audio URLs -> needs a JS evaluator shim (below). Browsers block this pattern.
// 2. YouTube strips audio-only URLs unless deciphered + requested with
//    YouTube Referer/Origin + Range. Browsers send localhost Origin -> 403.
// 3. InnerTube calls get CORS-blocked from browsers. So Node does the
//    search + decipher + byte-proxy, frontend just plays /api/stream.
Platform.shim.eval = async (data, env) => {
  const props = [];
  if (env?.n) props.push(`n: exportedVars.nFunction("${env.n}")`);
  if (env?.sig) props.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  const code = `${data.output}\nreturn { ${props.join(', ')} }`;
  return new Function(code)();
};

const app = express();
app.use(cors());
app.disable('x-powered-by');

let yt = null;
async function getYt() {
  if (!yt) {
    console.log('[yt] creating Innertube session...');
    // YT_COOKIE: paste a logged-in youtube.com cookie header (Render env var).
    // Datacenter IPs get "Sign in to confirm you're not a bot" on player
    // requests; an authenticated session bypasses that check.
    yt = await Innertube.create(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {});
    console.log(`[yt] session ready${process.env.YT_COOKIE ? ' (authenticated)' : ''}`);
  }
  return yt;
}

// Short-lived cache: videoId -> { url, itag, mime, expiresAt }
const urlCache = new Map();
const CACHE_MS = 10 * 60 * 1000;

const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://www.youtube.com/',
  Origin: 'https://www.youtube.com',
};

// 1KB probe: is this URL actually fetchable from THIS network?
async function verifyUrl(url) {
  try {
    const r = await fetch(url, { headers: { ...UPSTREAM_HEADERS, Range: 'bytes=0-1023' } });
    try { await r.body?.cancel(); } catch {}
    return r.status === 200 || r.status === 206;
  } catch { return false; }
}

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms)),
]);

// Candidate InnerTube clients, most-likely first. Direct-URL progressive
// formats (itag 18/22) need no decipher; ciphered audio needs the eval shim
// + a live upstream check because datacenter IPs get throttled/token-gated.
const CLIENT_PLAN = ['ANDROID', 'WEB', 'YTMUSIC', 'TV', 'ANDROID_VR', 'TV_EMBEDDED', 'WEB_EMBEDDED', 'MWEB'];

async function probeClient(innertube, videoId, clientName) {
  const info = await withTimeout(innertube.getBasicInfo(videoId, { client: clientName }), 12000, clientName);
  const status = info.playability_status?.status || 'UNKNOWN';
  const fmts = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])];
  const withUrl = fmts.filter((f) => f.url).length;
  return { info, status, fmts, withUrl };
}

function pickDirect(fmts) {
  return fmts.find((f) => f.itag === 18 && f.url) ||
    fmts.find((f) => f.itag === 22 && f.url) ||
    fmts.find((f) => f.has_audio && f.url) ||
    fmts.find((f) => f.url) || null;
}

function pickCiphered(fmts) {
  const audios = fmts.filter((f) => f.has_audio && (f.signature_cipher || f.cipher));
  return audios.find((f) => f.itag === 140) || audios.find((f) => f.mime_type?.includes('mp4')) || audios[0] || null;
}

async function resolveAudioUrl(videoId) {
  const cached = urlCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const innertube = await getYt();
  let lastErr = new Error('no playable format found');
  for (const name of CLIENT_PLAN) {
    try {
      const { info, status, fmts, withUrl } = await probeClient(innertube, videoId, name);
      if (status !== 'OK') { lastErr = new Error(`${name} playability: ${status}`); continue; }

      const direct = pickDirect(fmts);
      if (direct && await verifyUrl(direct.url)) {
        const entry = { url: direct.url, itag: direct.itag, mime: direct.mime_type?.split(';')[0] || 'video/mp4', expiresAt: Date.now() + CACHE_MS };
        urlCache.set(videoId, entry);
        console.log(`[yt] resolved ${videoId} itag=${direct.itag} via ${name} (direct)`);
        return entry;
      }
      const ciphered = pickCiphered(fmts);
      if (ciphered) {
        try {
          const url = await ciphered.decipher(innertube.session.player);
          if (await verifyUrl(url)) {
            const entry = { url, itag: ciphered.itag, mime: ciphered.mime_type?.split(';')[0] || 'audio/mp4', expiresAt: Date.now() + CACHE_MS };
            urlCache.set(videoId, entry);
            console.log(`[yt] resolved ${videoId} itag=${ciphered.itag} via ${name} (deciphered)`);
            return entry;
          }
          lastErr = new Error(`${name} deciphered URL not fetchable (network-gated)`);
        } catch (e) { lastErr = e; }
        continue;
      }
      lastErr = new Error(`${name}: ${fmts.length} formats, ${withUrl} with URL, none fetchable`);
    } catch (e) {
      lastErr = e;
      console.warn(`[yt] ${name} failed for ${videoId}:`, String(e && e.message || e).slice(0, 160));
    }
  }
  throw lastErr;
}

// Ground-truth report from THIS network: which clients yield playable audio?
app.get('/api/diag', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: 'bad id' });
    const innertube = await getYt();
    const report = [];
    for (const name of CLIENT_PLAN) {
      try {
        const { status, fmts, withUrl } = await probeClient(innertube, id, name);
        const direct = status === 'OK' ? pickDirect(fmts) : null;
        const ciphered = status === 'OK' && !direct ? pickCiphered(fmts) : null;
        let verified = null;
        if (direct) verified = await verifyUrl(direct.url);
        if (verified !== true && ciphered) {
          try { verified = await verifyUrl(await ciphered.decipher(innertube.session.player)); } catch { verified = false; }
        }
        report.push({ client: name, status, formats: fmts.length, withUrl, directItag: direct?.itag || null, cipheredItag: ciphered?.itag || null, verified });
      } catch (e) { report.push({ client: name, error: String(e && e.message || e).slice(0, 160) }); }
    }
    res.json({ id, auth: !!process.env.YT_COOKIE, report });
  } catch (e) { res.status(500).json({ error: String(e).slice(0, 300) }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, yt: !!yt, auth: !!process.env.YT_COOKIE }));

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ tracks: [] });
    const limit = Math.min(parseInt(req.query.limit || '12', 10) || 12, 25);
    const client = await getYt();
    const result = await client.search(q, { type: 'video' });
    const tracks = result.results
      .filter((r) => r.type === 'Video' && r.video_id)
      .slice(0, limit)
      .map((v) => ({
        videoId: v.video_id,
        title: v.title?.text || 'Unknown title',
        artist: v.author?.name || 'YouTube',
        durationSec: v.duration?.seconds || 0,
        durationText: v.duration?.text || v.length_text?.text || '',
        thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
        views: v.short_view_count?.text || v.view_count?.text || '',
      }));
    res.json({ tracks });
  } catch (e) {
    console.error('[yt] search failed:', e);
    res.status(500).json({ error: 'search failed', detail: String(e).slice(0, 300) });
  }
});

// Proxy audio bytes so the <audio> tag never touches googlevideo directly.
app.get('/api/stream', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: 'bad id' });
    const { url, mime } = await resolveAudioUrl(id);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    };
    if (req.headers.range) headers.Range = req.headers.range;
    // No forced Range: ANDROID progressive URLs support full + ranged alike.

    const upstream = await fetch(url, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      urlCache.delete(id);
      return res.status(502).json({ error: `upstream ${upstream.status}` });
    }
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    // Stream without buffering whole song in memory.
    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel().catch(() => {}));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch (e) {
    console.error('[yt] stream failed:', e);
    if (!res.headersSent) res.status(500).json({ error: 'stream failed', detail: String(e).slice(0, 300) });
    else res.end();
  }
});

const PORT = process.env.PORT || process.env.YT_PORT || 3001;
const server = http.createServer(app);

// --- Jam sync: tiny room hub. Clients share videoId + position, never stream URLs
// (URLs are IP-bound + expiring, each side resolves its own via /api/stream).
const rooms = new Map(); // code -> { members: Map<ws, name>, state: object|null }
const normalizeRoom = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanRoom = (code) => {
  const name = normalizeRoom(code) || 'JAM';
  if (!rooms.has(name)) rooms.set(name, { members: new Map(), state: null });
  return name;
};
const roomMembers = (room) => [...(rooms.get(room)?.members.values() || [])];
const broadcast = (room, msg, except = null) => {
  const r = rooms.get(room);
  if (!r) return;
  const data = JSON.stringify(msg);
  for (const [ws] of r.members) {
    if (ws !== except && ws.readyState === 1) ws.send(data);
  }
};

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  let room = null;
  let name = 'guest';
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'join' && msg.room) {
      if (room) rooms.get(room)?.members.delete(ws);
      const wanted = normalizeRoom(msg.room);
      if (!wanted) { ws.send(JSON.stringify({ t: 'error', message: 'Enter the room code first.' })); room = null; return; }
      // Joining needs an existing room (typos shouldn't strand you alone).
      // Only explicit creates may open a new one.
      if (!msg.create && !rooms.has(wanted)) {
        ws.send(JSON.stringify({ t: 'error', message: `No jam with code ${wanted} — check the code and try again.` }));
        room = null;
        return;
      }
      room = cleanRoom(wanted);
      name = String(msg.name || 'guest').slice(0, 24) || 'guest';
      rooms.get(room).members.set(ws, name);
      ws.send(JSON.stringify({ t: 'joined', room, members: roomMembers(room), state: rooms.get(room).state }));
      broadcast(room, { t: 'members', members: roomMembers(room) }, ws);
      console.log(`[jam] ${name} joined ${room} (${rooms.get(room).members.size})`);
      return;
    }
    if (!room) return;
    if (msg.t === 'state' && msg.state) {
      const state = { ...msg.state, at: Date.now(), by: name };
      rooms.get(room).state = state;
      broadcast(room, { t: 'state', state }, ws);
      return;
    }
    if (msg.t === 'bye') {
      rooms.get(room)?.members.delete(ws);
      broadcast(room, { t: 'members', members: roomMembers(room) });
      room = null;
    }
  });
  ws.on('close', () => {
    if (room && rooms.get(room)?.members.has(ws)) {
      rooms.get(room).members.delete(ws);
      broadcast(room, { t: 'members', members: roomMembers(room) });
      if (!rooms.get(room).members.size) rooms.delete(room);
    }
  });
});

app.get('/api/room/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const r = rooms.get(code);
  res.json({ room: code, members: r ? roomMembers(code) : [], hasState: !!r?.state });
});

// Single-service deploy: serve the built frontend (vite dist) from this same
// server so /api and /ws stay same-origin wherever it's hosted.
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

server.listen(PORT, () => console.log(`[jam] listening on http://localhost:${PORT}`));
