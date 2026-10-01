import featuredPlaylist from './featured-playlist.json'
import { createRoomCode, formatSeconds, getYoutubeErrorMessage, normalizePlaylists, parseStoredArray, toYoutubeTrack } from './app-utils'

const backend = (import.meta.env.VITE_JAM_API || '').replace(/\/$/, '')

export const api = (path) => `${backend}${path}`
export const BACKEND = backend

const localArtwork = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23221f26%22/%3E%3Ccircle cx=%2250%22 cy=%2242%22 r=%2222%22 fill=%22%23c5ef54%22 opacity=%22.8%22/%3E%3Cpath d=%22M24 74c16-14 28-8 52 0%22 fill=%22none%22 stroke=%22%23dbc6ab%22 stroke-width=%226%22/%3E%3C/svg%3E'

export const starterTracks = [{
  trackId: 'local-too-much-heaven',
  trackName: 'Too Much Heaven',
  artistName: 'Bee Gees',
  collectionName: 'Local music',
  artworkUrl100: localArtwork,
  previewUrl: '/songs/too-much-heaven.mp3',
  trackTimeMillis: 280000,
}]

export const localTracks = starterTracks

const artistAliases = {
  'Queen Official': 'Queen',
  beegees: 'Bee Gees',
  'Eurovision Song Contest': 'Alexander Rybak',
  'Universal Music India': 'Faheem Abdullah',
  'Play DMF and Harsh Nussi': 'Harsh Nussi',
  'T-Series': 'Arijit Singh',
  SagaHits: 'Satinder Sartaaj',
  'Sony Music India': 'Gajendra Verma',
  'Jatt Life Studios': 'Zehr Vibe',
  'Desi Music Factory': 'Akhil',
  'Collab Creations and SUKHA': 'Sukha',
  'Geet MP3': 'Nav Singh',
  'Chronicle Records': 'Armaan Gill',
  SHUBH: 'Shubh',
}

export const forHerPlaylist = {
  id: 'playlist-for-her',
  name: 'for her',
  description: 'The whole list, ready to play together',
  tracks: featuredPlaylist.map((track) => toYoutubeTrack({
    ...track,
    artist: artistAliases[track.artist] || track.artist.replace(/\s+Official$/i, '').trim(),
  }, api, 'feat')),
}

export const readStoredArray = (key) => {
  try {
    return parseStoredArray(localStorage.getItem(key))
  } catch {
    return []
  }
}

export const loadPlaylists = () => {
  const stored = readStoredArray('muse-playlists')
  return normalizePlaylists(stored, forHerPlaylist)
}

export { createRoomCode, formatSeconds, getYoutubeErrorMessage, parseStoredArray, toYoutubeTrack }
