import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRoomCode,
  formatSeconds,
  normalizePlaylists,
  normalizeRoomCode,
  toYoutubeTrack,
} from '../src/app-utils.js'

test('formats playback time for the player', () => {
  assert.equal(formatSeconds(0), '0:00')
  assert.equal(formatSeconds(65), '1:05')
  assert.equal(formatSeconds(3661), '61:01')
})

test('creates room codes that can be shared and joined', () => {
  const code = createRoomCode()

  assert.match(code, /^[A-Z2-9]{4}$/)
  assert.equal(normalizeRoomCode(` ${code.toLowerCase()}- `), code)
})

test('normalizes room input without changing the server contract', () => {
  assert.equal(normalizeRoomCode(' ab-c_12!3456789 '), 'ABC12345')
  assert.equal(normalizeRoomCode(''), '')
})

test('maps a search result into a playable YouTube track', () => {
  const track = toYoutubeTrack({
    videoId: 'abc12345678',
    title: 'A song',
    artist: 'An artist',
    thumbnail: 'https://img.test/song.jpg',
    durationSec: 187,
  }, (path) => `https://jam.test${path}`)

  assert.deepEqual(track, {
    trackId: 'yt-abc12345678',
    youtubeId: 'abc12345678',
    trackName: 'A song',
    artistName: 'An artist',
    collectionName: 'YouTube',
    artworkUrl100: 'https://img.test/song.jpg',
    previewUrl: 'https://jam.test/api/stream?id=abc12345678',
    trackTimeMillis: 187000,
  })
})

test('keeps the featured playlist when saved playlists do not contain it', () => {
  const featured = { id: 'playlist-for-her', name: 'for her', tracks: [] }
  const saved = [{ id: 'custom', name: 'Road trip', tracks: [] }]

  assert.deepEqual(normalizePlaylists(saved, featured), [featured, ...saved])
})

test('repairs the saved featured playlist without changing custom playlists', () => {
  const featured = { id: 'playlist-for-her', name: 'for her', tracks: [] }
  const saved = [
    { id: 'playlist-for-her', name: 'Old name', tracks: [{ trackId: '1', collectionName: 'YouTube' }] },
    { id: 'custom', name: 'Road trip', tracks: [{ trackId: '2' }] },
  ]

  assert.deepEqual(normalizePlaylists(saved, featured), [
    { id: 'playlist-for-her', name: 'for her', tracks: [{ trackId: '1', collectionName: '' }] },
    saved[1],
  ])
})
