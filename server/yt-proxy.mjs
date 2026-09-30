import express from 'express';
import cors from 'cors';
import http from 'node:http';
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
    yt = await Innertube.create({});
    console.log('[yt] session ready');
  }
  return yt;
}

// Short-lived cache: videoId -> { url, itag, mime, expiresAt }
const urlCache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function resolveAudioUrl(videoId) {
  const cached = urlCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const client = await getYt();
  // NOTE: YTMUSIC audio-only URLs (itag 140) decipher fine but YouTube
  // throttles them to ~1MB chunks with rn-sequencing (open ranges 403).
  // ANDROID progressive (itag 18/22) needs no decipher, no PO token,
  // supports full + ranged requests. <audio> ignores the video track.
  // So prefer any format that already has a usable URL.
  const attempts = [{ client: 'ANDROID' }, { client: 'WEB' }];
  let lastErr = null;
  for (const a of attempts) {
    try {
      const info = await client.getBasicInfo(videoId, { client: a.client });
      if (info.playability_status?.status !== 'OK') {
        lastErr = new Error(`playability: ${info.playability_status?.status} ${info.playability_status?.reason || ''}`);
        continue;
      }
      const fmts = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])];
      const pick =
        fmts.find((f) => f.itag === 18 && f.url) ||
        fmts.find((f) => f.itag === 22 && f.url) ||
        fmts.find((f) => f.has_audio && f.url) ||
        fmts.find((f) => f.url);
      if (!pick) {
        lastErr = new Error('no playable format with URL (all adaptive, need PO token)');
        continue;
      }
      const entry = { url: pick.url, itag: pick.itag, mime: pick.mime_type?.split(';')[0] || 'video/mp4', expiresAt: Date.now() + CACHE_MS };
      urlCache.set(videoId, entry);
      console.log(`[yt] resolved ${videoId} itag=${pick.itag} via ${a.client}`);
      return entry;
    } catch (e) {
      lastErr = e;
      console.warn(`[yt] ${a.client} failed for ${videoId}:`, String(e).slice(0, 200));
    }
  }
  throw lastErr || new Error('could not resolve audio');
}

app.get('/api/health', (_req, res) => res.json({ ok: true, yt: !!yt }));

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

const PORT = process.env.YT_PORT || 3001;
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

server.listen(PORT, () => console.log(`[yt-proxy] listening on http://localhost:${PORT}`));
