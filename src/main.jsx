import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import localTooMuchHeaven from '../songs/Bee Gees - Too Much Heaven (Official Video).mp3'
import {
  Album, Heart, Library, ListMusic,
  LoaderCircle, Pause, Play, Plus, Search, SkipBack,
  SkipForward, Sparkles, Trash2, Volume2, X, Zap
} from 'lucide-react'
import './styles.css'
import featuredPlaylist from './featured-playlist.json'

const localArtwork = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23221f26%22/%3E%3Ccircle cx=%2250%22 cy=%2242%22 r=%2222%22 fill=%22%23c5ef54%22 opacity=%22.8%22/%3E%3Cpath d=%22M24 74c16-14 28-8 52 0%22 fill=%22none%22 stroke=%22%23dbc6ab%22 stroke-width=%226%22/%3E%3C/svg%3E'

const starterTracks = [{
  trackId: 'local-too-much-heaven',
  trackName: 'Too Much Heaven',
  artistName: 'Bee Gees',
  collectionName: 'Local music',
  artworkUrl100: localArtwork,
  previewUrl: localTooMuchHeaven,
  trackTimeMillis: 280000,
}]

const localTracks = starterTracks
const normalPlaylists = []

const artistAliases = {
  'Queen Official': 'Queen',
  'beegees': 'Bee Gees',
  'Eurovision Song Contest': 'Alexander Rybak',
  'Universal Music India': 'Faheem Abdullah',
  'Play DMF and Harsh Nussi': 'Harsh Nussi',
  'T-Series': 'Arijit Singh',
  'SagaHits': 'Satinder Sartaaj',
  'Sony Music India': 'Gajendra Verma',
  'Jatt Life Studios': 'Zehr Vibe',
  'Desi Music Factory': 'Akhil',
  'Collab Creations and SUKHA': 'Sukha',
  'Geet MP3': 'Nav Singh',
  'Chronicle Records': 'Armaan Gill',
  'SHUBH': 'Shubh',
}

const forHerTracks = featuredPlaylist.map((t) => ({
  trackId: `feat-${t.videoId}`,
  youtubeId: t.videoId,
  trackName: t.title,
  artistName: artistAliases[t.artist] || t.artist.replace(/\s+Official$/i, '').trim(),
  collectionName: '',
  artworkUrl100: t.thumbnail,
  previewUrl: `/api/stream?id=${t.videoId}`,
  trackTimeMillis: (t.durationSec || 0) * 1000,
}))
const forHerPlaylist = { id: 'playlist-for-her', name: 'yours', description: 'The whole list, ready to play together', tracks: forHerTracks }

const formatTime = (ms = 0) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const formatSeconds = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

function App() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState(starterTracks)
  const [playlist, setPlaylist] = useState([])
  const [playlists, setPlaylists] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('muse-playlists') || 'null')
      if (Array.isArray(s) && s.length) {
        const normalized = s.map((p) => p.id === forHerPlaylist.id ? { ...p, name: 'yours', tracks: p.tracks.map((track) => ({ ...track, collectionName: '' })) } : p)
        return normalized.some((p) => p.id === forHerPlaylist.id) ? normalized : [forHerPlaylist, ...normalized]
      }
    } catch {}
    return [forHerPlaylist]
  })
  const [selectedPlaylist, setSelectedPlaylist] = useState('local')
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [current, setCurrent] = useState(starterTracks[0])
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(starterTracks[0].trackTimeMillis / 1000)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [activeTab, setActiveTab] = useState('Discover')
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [showJam, setShowJam] = useState(false)
  const [jamName, setJamName] = useState(() => `guest-${Math.floor(1000 + Math.random() * 9000)}`)
  const [jamRoomInput, setJamRoomInput] = useState('')
  const [jamRoom, setJamRoom] = useState('')
  const [jamMembers, setJamMembers] = useState([])
  const [jamStatus, setJamStatus] = useState('')
  const audioRef = useRef(null)
  const wsRef = useRef(null)
  const applyingRef = useRef(false)
  const jamRoomRef = useRef('')
  const currentRef = useRef(current)
  currentRef.current = current
  const jamConnected = !!jamRoom
  jamRoomRef.current = jamRoom

  useEffect(() => localStorage.setItem('muse-playlist', JSON.stringify(playlist)), [playlist])
  useEffect(() => localStorage.setItem('muse-playlists', JSON.stringify(playlists)), [playlists])
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    const syncTime = () => setCurrentTime(audio.currentTime || 0)
    const syncDuration = () => setDuration(audio.duration || current.trackTimeMillis / 1000)
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('ended', () => { setPlaying(false); setCurrentTime(0) })
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
    }
  }, [current.trackTimeMillis])

  // --- Jam sync (rooms share videoId + position, each side streams its own audio)
  const broadcastJam = (over = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1 || !jamRoomRef.current || applyingRef.current) return
    ws.send(JSON.stringify({
      t: 'state',
      room: jamRoomRef.current,
      state: {
        videoId: over.videoId ?? (current.youtubeId || null),
        track: over.track ?? current,
        position: over.position ?? (audioRef.current?.currentTime || 0),
        playing: over.playing ?? playing,
      },
    }))
  }

  const applyJamState = (state) => {
    if (!state?.track) return
    applyingRef.current = true
    const pos = state.position + (state.playing ? Math.max(0, (Date.now() - (state.at || Date.now())) / 1000) : 0)
    setTracks((old) => old.some((t) => t.trackId === state.track.trackId) ? old : [state.track, ...old])
    if (currentRef.current.trackId !== state.track.trackId) {
      setCurrent(state.track); setCurrentTime(pos); setDuration(state.track.trackTimeMillis / 1000 || 0)
      const audio = audioRef.current
      audio.src = state.track.previewUrl
      audio.currentTime = Math.max(0, pos - 0.2)
      if (state.playing) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      else { audio.pause(); setPlaying(false) }
    } else {
      const audio = audioRef.current
      if (Math.abs((audio.currentTime || 0) - pos) > 1.5) { audio.currentTime = Math.max(0, pos - 0.2); setCurrentTime(audio.currentTime) }
      if (state.playing && audio.paused) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      if (!state.playing && !audio.paused) { audio.pause(); setPlaying(false) }
    }
    setJamStatus(`${state.by || 'friend'} ${state.playing ? '▶' : '⏸'} ${state.track.trackName}`)
    setTimeout(() => { applyingRef.current = false }, 300)
  }

  const joinJam = (code, create = false) => {
    const room = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (!room) { setJamStatus('Enter the room code your friend shared first.'); return }
    setJamStatus('Connecting…')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
    if (wsRef.current) wsRef.current.close()
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name: jamName || 'guest', create }))
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === 'error') { setJamStatus(msg.message); try { ws.close() } catch {} wsRef.current = null; return }
      if (msg.t === 'joined') { setJamRoom(msg.room); setJamMembers(msg.members || []); setJamStatus(msg.state ? `Synced to ${msg.state.by || 'room'}` : `Joined ${msg.room} — press play to start`); if (msg.state) applyJamState(msg.state) }
      if (msg.t === 'members') setJamMembers(msg.members || [])
      if (msg.t === 'state') applyJamState(msg.state)
    }
    ws.onclose = () => { setJamStatus((s) => s && s.startsWith('No jam with code') ? s : 'Disconnected'); }
    ws.onerror = () => setJamStatus('Could not reach jam server — is `npm run proxy` running?')
  }
  const leaveJam = () => { try { wsRef.current?.send(JSON.stringify({ t: 'bye' })); wsRef.current?.close() } catch {} wsRef.current = null; setJamRoom(''); setJamMembers([]); setJamStatus('') }
  const makeRoomCode = () => { const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)]; return s }

  // Broadcast local play/pause/track changes (not remote-applied ones).
  useEffect(() => { if (jamRoom) broadcastJam() }, [current, playing]) // eslint-disable-line react-hooks/exhaustive-deps
  // Gentle drift correction while playing together.
  useEffect(() => {
    if (!jamRoom || !playing) return
    const id = setInterval(() => broadcastJam(), 5000)
    return () => clearInterval(id)
  }, [jamRoom, playing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => wsRef.current?.close(), [])

  const search = async (value = query) => {
    setQuery(value)
    if (!value.trim()) { setTracks(starterTracks); setSearchError(''); return }
    setLoading(true)
    setSearchError('')
    try {
      const ytRes = await fetch(`/api/search?q=${encodeURIComponent(value)}&limit=12`)
      if (!ytRes.ok) throw new Error(`proxy ${ytRes.status}`)
      const ytData = await ytRes.json()
      if (!ytData.tracks?.length) {
        setTracks(starterTracks)
        setSearchError(`No results for “${value}” — showing local music.`)
        return
      }
      setTracks(ytData.tracks.map((t) => ({
        trackId: `yt-${t.videoId}`,
        youtubeId: t.videoId,
        trackName: t.title,
        artistName: t.artist,
        collectionName: t.views ? `YouTube · ${t.views}` : 'YouTube',
        artworkUrl100: t.thumbnail,
        previewUrl: `/api/stream?id=${t.videoId}`,
        trackTimeMillis: (t.durationSec || 0) * 1000,
      })))
    } catch {
      setTracks(starterTracks)
      setSearchError('Something is wrong with YouTube search — showing local music. Is `npm run proxy` running?')
    }
    finally { setLoading(false) }
  }

  const togglePlay = (track = current) => {
    if (!track?.previewUrl && !track?.streamUrl) return
    if (current.trackId !== track.trackId) {
      setCurrent(track); setCurrentTime(0); setDuration(track.trackTimeMillis / 1000 || 0)
      audioRef.current.src = track.streamUrl || track.previewUrl
      audioRef.current.currentTime = 0
      audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      return
    }
    if (!audioRef.current.src) audioRef.current.src = track.streamUrl || track.previewUrl
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)) }
  }
  const seekTo = (value) => { const nextTime = Number(value); audioRef.current.currentTime = nextTime; setCurrentTime(nextTime); if (jamRoom) setTimeout(() => broadcastJam({ position: nextTime }), 50) }
  const skipBy = (seconds) => seekTo(Math.max(0, Math.min(duration || 0, (audioRef.current.currentTime || 0) + seconds)))
  const viewingCustom = selectedPlaylist !== 'local' && selectedPlaylist !== 'my'
  const customViewed = viewingCustom ? playlists.find((item) => item.id === selectedPlaylist) : null
  // The + button always targets what you're looking at: a custom playlist when
  // one is open, otherwise My playlist. Clicking again removes it (toggle).
  const isInTarget = (track) => viewingCustom && customViewed
    ? customViewed.tracks.some((song) => song.trackId === track.trackId)
    : playlist.some((song) => song.trackId === track.trackId)
  const toggleTrack = (track) => {
    if (viewingCustom && customViewed) {
      setPlaylists((old) => old.map((item) => {
        if (item.id !== selectedPlaylist) return item
        const has = item.tracks.some((song) => song.trackId === track.trackId)
        return { ...item, tracks: has ? item.tracks.filter((song) => song.trackId !== track.trackId) : [...item.tracks, track] }
      }))
      return
    }
    setPlaylist((old) => old.some((item) => item.trackId === track.trackId) ? old.filter((item) => item.trackId !== track.trackId) : [...old, track])
  }
  const addToPlaylist = toggleTrack
  const removeFromPlaylist = (id) => setPlaylist((old) => old.filter((item) => item.trackId !== id))
  const deletePlaylist = (id) => {
    setPlaylists((old) => old.filter((item) => item.id !== id))
    if (selectedPlaylist === id) { setSelectedPlaylist('local'); setActiveTab('Library'); setTracks(localTracks) }
  }
  const requestDelete = (target) => setConfirmDelete(target)
  const confirmRemoval = () => {
    if (!confirmDelete) return
    if (confirmDelete.kind === 'playlist') deletePlaylist(confirmDelete.id)
    if (confirmDelete.kind === 'track') {
      if (confirmDelete.playlistId === 'my') removeFromPlaylist(confirmDelete.id)
      else setPlaylists((old) => old.map((item) => item.id === confirmDelete.playlistId ? { ...item, tracks: item.tracks.filter((track) => track.trackId !== confirmDelete.id) } : item))
    }
    setConfirmDelete(null)
  }
  const selectedLibraryTracks = selectedPlaylist === 'local'
    ? localTracks
    : playlists.find((item) => item.id === selectedPlaylist)?.tracks || playlist
  const openPlaylist = (id) => { setSelectedPlaylist(id); setActiveTab('Library'); setTracks(id === 'local' ? localTracks : playlists.find((item) => item.id === id)?.tracks || playlist) }
  const createPlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    const created = { id: `playlist-${Date.now()}`, name, description: 'A playlist you made', tracks: [] }
    setPlaylists((old) => [...old, created]); setNewPlaylistName(''); setShowCreatePlaylist(false); setSelectedPlaylist(created.id); setActiveTab('Library'); setTracks([])
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Sparkles size={16} /></span><span>glass</span></div>
      <div className="nav-label">YOUR LIBRARY</div>
      <nav className="nav-group library-nav">
        <NavItem icon={<Heart size={18} />} label="Local songs" badge={localTracks.length} active={selectedPlaylist === 'local'} onClick={() => openPlaylist('local')} />
        <NavItem icon={<ListMusic size={18} />} label="My playlist" badge={playlist.length} onClick={() => setShowPlaylist(true)} />
      </nav>
      <div className="nav-label playlist-label"><span>PLAYLISTS</span><button className="add-playlist-button" onClick={() => setShowCreatePlaylist(true)} aria-label="Create playlist"><Plus size={14} /></button></div>
      <nav className="nav-group library-nav">
        {playlists.map((item) => <div key={item.id} className="playlist-nav-row"><NavItem icon={<Album size={17} />} label={item.name} active={selectedPlaylist === item.id} onClick={() => openPlaylist(item.id)} /><button className="nav-delete" onClick={() => requestDelete({ kind: 'playlist', id: item.id, label: item.name })} aria-label={`Delete ${item.name}`} title={`Delete ${item.name}`}><Trash2 size={14}/></button></div>)}
      </nav>
      <div className="sidebar-bottom"><div className="tiny-label">YOUR SPACE</div><button className="space-card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setShowJam(true)}><div className="space-glow"><Zap size={18} /></div><div><strong>Jam with a friend</strong><span>{jamRoom ? `● ${jamRoom} · ${jamMembers.length}` : 'Start a room'}</span></div><span className="soon">{jamRoom ? 'LIVE' : 'JAM'}</span></button><div className="sidebar-foot"><span>© 2026 glass</span><span>v0.1 beta</span></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="search-wrap"><Search size={18} /><input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) search('') }} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search artists, songs, albums..."/>{query && <button className="clear-search" onClick={() => search('')}><X size={15}/></button>}</div></header>
      <section className="welcome-row"><div><h1>{activeTab === 'Library' ? <>{playlists.find((item) => item.id === selectedPlaylist)?.name || 'Local songs'} <em>collection.</em></> : <>Find your next <em>favorite.</em></>}</h1>{activeTab === 'Library' && !viewingCustom && <p>{selectedPlaylist === 'local' ? 'Music available in this project.' : playlists.find((item) => item.id === selectedPlaylist)?.description}</p>}</div>{activeTab === 'Library' && viewingCustom && <button className="text-button" onClick={() => requestDelete({ kind: 'playlist', id: selectedPlaylist, label: playlists.find((item) => item.id === selectedPlaylist)?.name })}><Trash2 size={14}/> Delete playlist</button>}</section>
      <section className="section-head"><div><h3>{query ? `Results for “${query}”` : activeTab === 'Library' ? `${selectedLibraryTracks.length} songs` : 'Made for this moment'}</h3><p>{query ? 'Pick a track to preview or add to your playlist.' : activeTab === 'Library' ? 'Your saved music, ready whenever you are.' : 'A few places to start your listening journey.'}</p></div>{query && <button className="text-button" onClick={() => search('')}>Clear search</button>}</section>
      <section className="track-grid">{searchError && !loading && <div className="empty">{searchError}</div>}{loading ? <div className="loading"><LoaderCircle className="spin" size={22}/> Finding something good...</div> : tracks.slice(0, activeTab === 'Library' ? tracks.length : 6).map((track, i) => <TrackCard key={track.trackId} track={track} index={i} current={current} playing={playing} onPlay={() => togglePlay(track)} onAdd={() => (viewingCustom && isInTarget(track) ? requestDelete({ kind: 'track', id: track.trackId, label: track.trackName, playlistId: selectedPlaylist }) : toggleTrack(track))} inPlaylist={isInTarget(track)} isRemove={viewingCustom && isInTarget(track)} hideCollection={viewingCustom} />)}{!loading && !searchError && !tracks.length && <div className="empty">No tracks found. Try another artist or song.</div>}</section>
    </main>

    <footer className="player"><div className="now-playing"><img src={current.artworkUrl100}/><div><strong>{current.trackName}</strong></div><Heart size={17} /></div><div className="player-controls"><div className="control-buttons"><button onClick={() => skipBy(-10)} aria-label="Skip back 10 seconds"><SkipBack size={17} fill="currentColor" /></button><button className="play-button" onClick={() => togglePlay(current)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button onClick={() => skipBy(10)} aria-label="Skip forward 10 seconds"><SkipForward size={17} fill="currentColor" /></button></div><div className="progress"><span>{formatSeconds(currentTime)}</span><input className="progress-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(e) => seekTo(e.target.value)} aria-label="Seek through song"/><span>{formatSeconds(duration)}</span></div></div><div className="player-right"><Volume2 size={17}/><input className="volume-range" type="range" min="0" max="1" step="0.01" defaultValue="1" onChange={(e) => { audioRef.current.volume = Number(e.target.value) }} aria-label="Volume"/><button className="queue-button" onClick={() => setShowPlaylist(true)}><ListMusic size={17}/></button></div></footer>
    {showPlaylist && <div className="modal-backdrop" onClick={() => setShowPlaylist(false)}><section className="playlist-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">YOUR LIBRARY</div><h2>My playlist <span>{playlist.length}</span></h2></div><button className="icon-button" onClick={() => setShowPlaylist(false)}><X size={20}/></button></div><div className="modal-list">{playlist.map((track, i) => <div className="modal-track" key={track.trackId}><span className="track-number">{String(i + 1).padStart(2, '0')}</span><img src={track.artworkUrl100}/><div className="modal-copy"><strong>{track.trackName}</strong></div><button onClick={() => togglePlay(track)}>{playing && current.trackId === track.trackId ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="remove-button" onClick={() => requestDelete({ kind: 'track', id: track.trackId, label: track.trackName, playlistId: 'my' })}><Trash2 size={15}/></button></div>)}</div><div className="modal-footer"><button className="primary-button small" onClick={() => { setShowPlaylist(false); document.querySelector('.search-wrap input')?.focus() }}><Plus size={15}/> Add songs</button></div></section></div>}
    {confirmDelete && <div className="confirm-backdrop" onClick={() => setConfirmDelete(null)}><section className="confirm-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}><div className="confirm-icon"><Trash2 size={19}/></div><div><h2>{confirmDelete.kind === 'playlist' ? 'Delete this playlist?' : 'Remove this song?'}</h2><p>{confirmDelete.kind === 'playlist' ? `“${confirmDelete.label}” and its songs will be removed.` : `Remove “${confirmDelete.label}” from this playlist?`}</p></div><div className="confirm-actions"><button className="text-button" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="danger-button" onClick={confirmRemoval}>Delete</button></div></section></div>}
    {showCreatePlaylist && <div className="modal-backdrop" onClick={() => setShowCreatePlaylist(false)}><section className="create-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">NEW PLAYLIST</div><h2>Create a playlist</h2></div><button className="icon-button" onClick={() => setShowCreatePlaylist(false)}><X size={20}/></button></div><div className="create-body"><label htmlFor="playlist-name">Playlist name</label><input id="playlist-name" autoFocus value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createPlaylist()} placeholder="e.g. songs for the drive"/><div className="create-actions"><button className="text-button" onClick={() => setShowCreatePlaylist(false)}>Cancel</button><button className="primary-button small" onClick={createPlaylist}><Plus size={15}/> Create playlist</button></div></div></section></div>}
    {showJam && <div className="modal-backdrop" onClick={() => setShowJam(false)}><section className="create-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">LISTEN TOGETHER</div><h2>Jam {jamRoom && <span>● {jamRoom}</span>}</h2></div><button className="icon-button" onClick={() => setShowJam(false)}><X size={20}/></button></div><div className="create-body">
      {!jamRoom ? <>
        <label htmlFor="jam-name">Your name</label><input id="jam-name" value={jamName} onChange={(e) => setJamName(e.target.value)} placeholder="e.g. hardi" style={{ marginBottom: 14 }} />
        <label htmlFor="jam-code">Room code (ask your friend for theirs)</label><input id="jam-code" value={jamRoomInput} onChange={(e) => setJamRoomInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && joinJam(jamRoomInput)} placeholder="e.g. KQ4M" style={{ marginBottom: 14 }} />
        <div className="create-actions"><button className="text-button" onClick={() => { const c = makeRoomCode(); setJamRoomInput(c); joinJam(c, true) }}>Create new room</button><button className="primary-button small" onClick={() => joinJam(jamRoomInput)}><Zap size={15}/> Join jam</button></div>
      </> : <>
        <label>Who's in ({jamMembers.length})</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{jamMembers.map((m) => <span key={m} className="status-pill"><span className="status-dot"/>{m}</span>)}</div>
        <label>Share this code with your friend</label><input readOnly value={jamRoom} onFocus={(e) => e.target.select()} style={{ marginBottom: 14, fontWeight: 800, letterSpacing: '.1em' }} />
        <div className="create-actions"><button className="text-button" onClick={leaveJam}>Leave</button><button className="primary-button small" onClick={() => { broadcastJam(); setShowJam(false) }}><Play size={15}/> Sync now</button></div>
      </>}
      {jamStatus && <p style={{ color: '#88818e', fontSize: 11, marginTop: 14 }}>{jamStatus}</p>}
    </div></section></div>}
  </div>
}

function NavItem({ icon, label, active, badge, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{badge && <small>{badge}</small>}</button> }
function TrackCard({ track, index, current, playing, onPlay, onAdd, inPlaylist, isRemove, hideCollection }) { return <article className={`track-card ${current.trackId === track.trackId ? 'selected' : ''}`}><div className="cover-wrap"><img src={track.artworkUrl100?.replace('100x100', '300x300')} alt=""/><button className="card-play" onClick={onPlay} disabled={!track.previewUrl && !track.streamUrl}>{playing && current.trackId === track.trackId ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><span className="track-index">0{index + 1}</span></div><div className="track-meta"><div className="track-title">{track.trackName}</div><div className="track-bottom"><span>{hideCollection ? '' : track.collectionName || ''}</span><button className={inPlaylist ? 'added' : ''} onClick={onAdd} aria-label={isRemove ? 'Remove from playlist' : inPlaylist ? 'Remove from My playlist' : 'Add to playlist'} title={isRemove ? 'Remove from playlist' : inPlaylist ? 'Remove from My playlist' : 'Add to playlist'}>{isRemove ? <X size={16}/> : inPlaylist ? <Heart size={15} fill="currentColor"/> : <Plus size={16}/>}</button></div></div></article> }

createRoot(document.getElementById('root')).render(<App />)
