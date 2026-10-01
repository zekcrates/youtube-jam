export const formatSeconds = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export const createRoomCode = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export const normalizeRoomCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)

export const parseStoredArray = (value) => {
  try {
    const parsed = JSON.parse(value || 'null')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const hasTrack = (tracks, trackId) => tracks.some((track) => track.trackId === trackId)

export const addTrack = (tracks, track) => hasTrack(tracks, track.trackId) ? tracks : [...tracks, track]

export const removeTrack = (tracks, trackId) => tracks.filter((track) => track.trackId !== trackId)

export const toggleTrack = (tracks, track) => hasTrack(tracks, track.trackId)
  ? removeTrack(tracks, track.trackId)
  : [...tracks, track]

export const toYoutubeTrack = (track, api, prefix = 'yt') => ({
  trackId: `${prefix}-${track.videoId}`,
  youtubeId: track.videoId,
  trackName: track.title,
  artistName: track.artist,
  collectionName: 'YouTube',
  artworkUrl100: track.thumbnail,
  previewUrl: api(`/api/stream?id=${track.videoId}`),
  trackTimeMillis: (track.durationSec || 0) * 1000,
})

export const normalizePlaylists = (stored, featuredPlaylist) => {
  if (!stored.length) return [featuredPlaylist]

  const normalized = stored.map((playlist) => playlist.id === featuredPlaylist.id
    ? { ...playlist, name: 'for her', tracks: (Array.isArray(playlist.tracks) ? playlist.tracks : []).map((track) => ({ ...track, collectionName: '' })) }
    : playlist)

  return normalized.some((playlist) => playlist.id === featuredPlaylist.id)
    ? normalized
    : [featuredPlaylist, ...normalized]
}
