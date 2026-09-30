import { Innertube } from 'youtubei.js';
import { writeFileSync } from 'node:fs';
import { SONGS } from './playlist-songs.mjs';

const yt = await Innertube.create({});
console.log('session ready, resolving', SONGS.length, 'songs...');
const out = [];
for (const [i, s] of SONGS.entries()) {
  const q = `${s.title} ${s.artist}`;
  try {
    const res = await yt.search(q, { type: 'video' });
    const v = res.results.find((r) => r.type === 'Video' && r.video_id);
    if (!v) { console.log(`${i + 1}. NO RESULT: ${q}`); continue; }
    out.push({
      title: v.title?.text || s.title,
      artist: v.author?.name || s.artist,
      videoId: v.video_id,
      durationSec: v.duration?.seconds || 0,
      thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
      query: q,
    });
    console.log(`${i + 1}. OK ${v.video_id} - ${v.title?.text}`);
  } catch (e) {
    console.log(`${i + 1}. FAIL ${q}:`, String(e).slice(0, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
}
writeFileSync(new URL('../src/featured-playlist.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`done: ${out.length}/${SONGS.length} resolved -> src/featured-playlist.json`);
process.exit(0);
