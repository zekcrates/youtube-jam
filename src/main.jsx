import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Album, Check, Heart, Home, Library, ListMusic, MessageCircle,
  LoaderCircle, Menu, Pause, Play, Plus, Send, SkipBack,
  SkipForward, Trash2, Volume2, X, Zap
} from 'lucide-react'
import './styles.css'
import { NavItem, SearchBar, TrackCard } from './components'
import {
  api, BACKEND, forHerPlaylist, formatSeconds, loadPlaylists,
  createRoomCode, localTracks, readStoredArray, starterTracks, toYoutubeTrack,
} from './app-data'
import { addTrack as addTrackToList, hasTrack, normalizeRoomCode, removeTrack, toggleTrack as toggleListTrack } from './app-utils'

function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState(starterTracks)
  const [playlist, setPlaylist] = useState([])
  const [playlists, setPlaylists] = useState(loadPlaylists)
  const [selectedPlaylist, setSelectedPlaylist] = useState('local')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [liked, setLiked] = useState(() => readStoredArray('glass-liked'))
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [addTarget, setAddTarget] = useState(null)
  const [adInfo, setAdInfo] = useState(null)
  const [toasts, setToasts] = useState([])
  const [suggest, setSuggest] = useState([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIdx, setSuggestIdx] = useState(-1)
  const suggestTimer = useRef(null)
  const toastId = useRef(0)
  const pushToast = (msg, kind = 'ok') => {
    const id = ++toastId.current
    setToasts((old) => [...old.slice(-2), { id, msg, kind }])
    setTimeout(() => setToasts((old) => old.filter((t) => t.id !== id)), 2800)
  }
  const [current, setCurrent] = useState(starterTracks[0])
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(starterTracks[0].trackTimeMillis / 1000)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [activeTab, setActiveTab] = useState('Discover')
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [showJam, setShowJam] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [jamName, setJamName] = useState(() => `guest-${Math.floor(1000 + Math.random() * 9000)}`)
  const [jamRoomInput, setJamRoomInput] = useState('')
  const [jamRoom, setJamRoom] = useState('')
  const [jamMembers, setJamMembers] = useState([])
  const [jamMessages, setJamMessages] = useState([])
  const [jamDraft, setJamDraft] = useState('')
  const [jamStatus, setJamStatus] = useState('')
  const audioRef = useRef(null)
  const ytRef = useRef({ player: null, ready: false, videoId: null })
  const pendingRef = useRef(null)
  const wsRef = useRef(null)
  const applyingRef = useRef(false)
  const jamRoomRef = useRef('')
  const jamMembersRef = useRef([])
  const chatEndRef = useRef(null)
  const currentRef = useRef(current)
  currentRef.current = current
  jamRoomRef.current = jamRoom

  useEffect(() => {
    if (showChat) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [jamMessages.length, showChat])

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1400)
    return () => clearTimeout(timer)
  }, [])

  const watchAutoplay = (track) => {
    setTimeout(() => {
      try {
        const p = ytRef.current.player
        if (!p || ytRef.current.videoId !== track.youtubeId) return
        const st = p.getPlayerState()
        if (st === window.YT.PlayerState.CUED || st === window.YT.PlayerState.UNSTARTED) {
          setPlaying(false)
          pushToast('Tap play to join the sound')
        }
      } catch {}
    }, 2500)
  }

  useEffect(() => localStorage.setItem('muse-playlist', JSON.stringify(playlist)), [playlist])
  useEffect(() => localStorage.setItem('muse-playlists', JSON.stringify(playlists)), [playlists])
  useEffect(() => localStorage.setItem('glass-liked', JSON.stringify(liked)), [liked])
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

  const ytExec = (a) => {
    const slot = ytRef.current
    if (!slot.ready || !slot.player) { if (a.type === 'load') pendingRef.current = a; return }
    try {
      const p = slot.player
      if (a.type === 'load') {
        slot.videoId = a.videoId
        if (a.play) p.loadVideoById({ videoId: a.videoId, startSeconds: Math.max(0, a.pos || 0) })
        else p.cueVideoById({ videoId: a.videoId, startSeconds: Math.max(0, a.pos || 0) })
      }
      else if (a.type === 'play') p.playVideo()
      else if (a.type === 'pause') p.pauseVideo()
      else if (a.type === 'seek') p.seekTo(Math.max(0, a.pos || 0), true)
      else if (a.type === 'stop' && slot.videoId) { p.stopVideo(); slot.videoId = null }
    } catch {}
  }
  const getPosition = () => {
    if (currentRef.current.youtubeId && ytRef.current.ready && ytRef.current.videoId) {
      try { const t = ytRef.current.player.getCurrentTime(); if (typeof t === 'number' && !Number.isNaN(t)) return t } catch {}
    }
    return audioRef.current?.currentTime || 0
  }
  const setTrack = (track, position) => {
    setAdInfo(null)
    setCurrent(track)
    setCurrentTime(position)
    setDuration(track.trackTimeMillis / 1000 || 0)
  }

  const playYoutubeTrack = (track, position, shouldPlay) => {
    try { audioRef.current?.pause() } catch {}
    setPlaying(shouldPlay)
    ytExec({ type: 'load', videoId: track.youtubeId, pos: position, play: shouldPlay })
    if (shouldPlay) watchAutoplay(track)
  }

  const playLocalTrack = (track, position, shouldPlay) => {
    ytExec({ type: 'stop' })
    const audio = audioRef.current
    audio.src = track.streamUrl || track.previewUrl
    audio.currentTime = Math.max(0, position)
    if (shouldPlay) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    else { audio.pause(); setPlaying(false) }
  }

  const playTrackAt = (track, position, shouldPlay) => {
    setTrack(track, position)
    if (track.youtubeId) playYoutubeTrack(track, position, shouldPlay)
    else playLocalTrack(track, position, shouldPlay)
  }

  useEffect(() => {
    let cancelled = false
    const create = () => {
      if (cancelled || ytRef.current.player || !window.YT?.Player) return
      try {
        ytRef.current.player = new window.YT.Player('jam-yt-player', {
          height: '2', width: '2',
          playerVars: { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0 },
          events: {
            onReady: () => { ytRef.current.ready = true; if (pendingRef.current && !cancelled) { const p = pendingRef.current; pendingRef.current = null; ytExec(p) } },
            onStateChange: (e) => {
              const st = window.YT?.PlayerState
              if (!st) return
              if (e.data === st.PLAYING) { setPlaying(true); try { const d = ytRef.current.player.getDuration(); if (d) setDuration(d) } catch {} }
              else if (e.data === st.PAUSED) setPlaying(false)
              else if (e.data === st.ENDED) { setPlaying(false); setCurrentTime(0) }
            },
            onError: () => { setPlaying(false); setSearchError('This song can’t play here — the owner disabled embedding. Pick another.') },
          },
        })
      } catch {}
    }
    if (window.YT?.Player) create()
    else {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); create() }
      document.head.appendChild(tag)
    }
    return () => { cancelled = true }
  }, [])

  const broadcastJam = (over = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1 || !jamRoomRef.current || applyingRef.current) return
    ws.send(JSON.stringify({
      t: 'state',
      room: jamRoomRef.current,
      state: {
        videoId: over.videoId ?? (current.youtubeId || null),
        track: over.track ?? current,
        position: over.position ?? getPosition(),
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
      playTrackAt(state.track, pos, state.playing)
    } else {
      if (Math.abs(getPosition() - pos) > 0.7) {
        const fixed = Math.max(0, pos - 0.2)
        if (state.track.youtubeId && ytRef.current.ready) ytExec({ type: 'seek', pos: fixed })
        else if (audioRef.current) audioRef.current.currentTime = fixed
        setCurrentTime(fixed)
      }
      let paused = true
      if (state.track.youtubeId && ytRef.current.ready && window.YT?.PlayerState) {
        try { paused = ytRef.current.player.getPlayerState() !== window.YT.PlayerState.PLAYING } catch {}
      } else paused = audioRef.current?.paused ?? true
      if (state.playing && paused) {
        setPlaying(true)
        if (state.track.youtubeId) ytExec({ type: 'play' })
        else audioRef.current?.play()?.then(() => setPlaying(true)).catch(() => setPlaying(false))
      }
      if (!state.playing && !paused) {
        setPlaying(false)
        if (state.track.youtubeId) ytExec({ type: 'pause' })
        else audioRef.current?.pause()
      }
    }
    setTimeout(() => { applyingRef.current = false }, 300)
  }

  const joinJam = (code, create = false, asName) => {
    const room = normalizeRoomCode(code)
    if (!room) { setJamStatus('Enter the room code your friend shared first.'); return }
    const who = (asName || jamName || 'guest').slice(0, 24)
    setJamStatus('Connecting…')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = BACKEND ? `${BACKEND.replace(/^http/, 'ws')}/ws` : `${proto}://${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    if (wsRef.current) wsRef.current.close()
    jamMembersRef.current = []
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name: who, create }))
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === 'error') { setJamStatus(msg.message); try { localStorage.removeItem('jam-session') } catch {} try { ws.close() } catch {} wsRef.current = null; return }
      if (msg.t === 'joined') {
        const members = msg.members || []
        jamMembersRef.current = members
        setJamMessages([])
        setJamRoom(msg.room)
        setJamMembers(members)
        setJamStatus(msg.state ? `Synced to ${msg.state.by || 'room'}` : '')
        try { localStorage.setItem('jam-session', JSON.stringify({ room: msg.room, name: who })) } catch {}
        pushToast(`Joined room ${msg.room}`)
        if (msg.state) applyJamState(msg.state)
      }
      if (msg.t === 'members') {
        const previous = jamMembersRef.current
        const members = msg.members || []
        if (previous.length) {
          members.filter((member) => !previous.includes(member)).forEach((member) => pushToast(`${member} joined the jam`))
          previous.filter((member) => !members.includes(member)).forEach((member) => pushToast(`${member} left the jam`))
        }
        jamMembersRef.current = members
        setJamMembers(members)
      }
      if (msg.t === 'chat' && msg.message?.text) {
        setJamMessages((old) => [...old.slice(-39), msg.message])
      }
      if (msg.t === 'state') applyJamState(msg.state)
    }
    ws.onclose = () => { setJamStatus((s) => s && s.startsWith('No jam with code') ? s : 'Disconnected'); }
    ws.onerror = () => setJamStatus('Could not reach the jam — check your connection and try again.')
  }
  const sendJamChat = (event) => {
    event.preventDefault()
    const text = jamDraft.trim().slice(0, 280)
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    try {
      wsRef.current.send(JSON.stringify({ t: 'chat', text }))
      setJamMessages((old) => [...old.slice(-39), { name: jamName || 'guest', text, at: Date.now() }])
    } catch {
      pushToast('Chat is unavailable right now', 'error')
      return
    }
    setJamDraft('')
  }
  const closeJamConnection = () => {
    try {
      wsRef.current?.send(JSON.stringify({ t: 'bye' }))
      wsRef.current?.close()
    } catch {}
    wsRef.current = null
  }

  const resetJamState = () => {
    jamMembersRef.current = []
    setJamRoom('')
    setJamMembers([])
    setJamMessages([])
    setJamDraft('')
    setShowChat(false)
    setJamStatus('')
  }

  const leaveJam = () => {
    closeJamConnection()
    resetJamState()
    localStorage.removeItem('jam-session')
    pushToast('Left the jam')
  }
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('jam-session') || 'null')
      if (s?.room) { if (s.name) setJamName(s.name); joinJam(s.room, false, s.name) }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jamRoom) broadcastJam() }, [current, playing])
  useEffect(() => {
    if (!jamRoom || !playing) return
    const id = setInterval(() => broadcastJam(), 3000)
    return () => clearInterval(id)
  }, [jamRoom, playing])
  useEffect(() => () => wsRef.current?.close(), [])
  useEffect(() => {
    if (!playing || !current.youtubeId) return
    const id = setInterval(() => {
      try {
        const p = ytRef.current.player
        const t = p?.getCurrentTime()
        if (typeof t === 'number' && !Number.isNaN(t)) setCurrentTime(t)
        const vd = p?.getVideoData?.()
        if (vd?.video_id && vd.video_id !== currentRef.current.youtubeId) {
          try { const d = p?.getDuration(); if (d) setDuration(d) } catch {}
          setAdInfo((old) => old?.id === vd.video_id ? old : { id: vd.video_id, title: vd.title || 'Advertisement', author: vd.author || '' })
        } else setAdInfo((old) => (old ? null : old))
      } catch {}
    }, 500)
    return () => clearInterval(id)
  }, [playing, current])
  useEffect(() => {
    try {
      if (adInfo) {
        const w = Math.min(320, window.innerWidth - 24)
        ytRef.current.player?.setSize(w, Math.round(w * 9 / 16))
      } else ytRef.current.player?.setSize(2, 2)
    } catch {}
  }, [adInfo])

  const fetchSuggest = (value) => {
    clearTimeout(suggestTimer.current)
    const v = String(value || '').trim()
    if (v.length < 2) { setSuggest([]); setSuggestOpen(false); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(api(`/api/suggest?q=${encodeURIComponent(v)}`))
        if (!r.ok) return
        const d = await r.json()
        setSuggest(d.suggestions || [])
        setSuggestOpen((d.suggestions || []).length > 0)
        setSuggestIdx(-1)
      } catch {}
    }, 250)
  }
  const pickSuggest = (value) => { setSuggestOpen(false); setSuggest([]); search(value) }

  const handleSearchInput = (value) => {
    setQuery(value)
    fetchSuggest(value)
    if (value) setTracks([])
    else search('')
  }

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestOpen) {
      event.preventDefault()
      setSuggestIdx((index) => (index + 1) % suggest.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestOpen) {
      event.preventDefault()
      setSuggestIdx((index) => (index - 1 + suggest.length) % suggest.length)
      return
    }
    if (event.key === 'Enter') {
      if (suggestOpen && suggestIdx >= 0 && suggest[suggestIdx]) pickSuggest(suggest[suggestIdx])
      else { setSuggestOpen(false); search() }
      return
    }
    if (event.key === 'Escape') {
      setSuggestOpen(false)
      setSuggest([])
    }
  }

  const search = async (value = query) => {
    setQuery(value)
    if (!value.trim()) { setTracks(starterTracks); setSearchError(''); return }
    setTracks([])
    setLoading(true)
    setSearchError('')
    try {
      const ytRes = await fetch(api(`/api/search?q=${encodeURIComponent(value)}&limit=12`))
      if (!ytRes.ok) throw new Error(`proxy ${ytRes.status}`)
      const ytData = await ytRes.json()
      if (!ytData.tracks?.length) {
        setTracks(starterTracks)
        setSearchError(`No results for “${value}” — showing local music.`)
        return
      }
      setTracks(ytData.tracks.map((track) => toYoutubeTrack(track)))
    } catch {
      setTracks(starterTracks)
      setSearchError('Search isn’t available right now — showing local music.')
    }
    finally { setLoading(false) }
  }

  const toggleYoutubePlayback = (track) => {
    const isNewTrack = current.trackId !== track.trackId || ytRef.current.videoId !== track.youtubeId
    if (isNewTrack) playTrackAt(track, 0, true)
    else if (playing) { setPlaying(false); ytExec({ type: 'pause' }) }
    else { setPlaying(true); ytExec({ type: 'play' }) }
  }

  const toggleLocalPlayback = (track) => {
    if (!track.previewUrl && !track.streamUrl) return
    if (current.trackId !== track.trackId) {
      playTrackAt(track, 0, true)
      return
    }
    if (!audioRef.current.src) audioRef.current.src = track.streamUrl || track.previewUrl
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const togglePlay = (track = current) => {
    if (!track) return
    if (track.youtubeId) toggleYoutubePlayback(track)
    else toggleLocalPlayback(track)
  }
  const seekTo = (value) => {
    const nextTime = Number(value)
    if (currentRef.current.youtubeId && ytRef.current.ready) ytExec({ type: 'seek', pos: nextTime })
    else if (audioRef.current) audioRef.current.currentTime = nextTime
    setCurrentTime(nextTime)
    try { navigator.mediaSession?.setPositionState?.({ duration: duration || 0, playbackRate: 1, position: Math.min(nextTime, duration || 0) }) } catch {}
    if (jamRoom) setTimeout(() => broadcastJam({ position: nextTime }), 50)
  }
  const skipBy = (seconds) => seekTo(Math.max(0, Math.min(duration || 0, getPosition() + seconds)))
  const stepTrack = (dir) => {
    const list = tracks.length ? tracks : [current]
    const i = list.findIndex((t) => t.trackId === current.trackId)
    const next = list[(i + dir + list.length) % list.length]
    if (next) togglePlay(next)
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.trackName || 'jam',
        artist: current.artistName || '',
        album: current.collectionName || '',
        artwork: current.artworkUrl100 ? [{ src: current.artworkUrl100, sizes: '512x512' }] : [],
      })
    } catch {}
  }, [current])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try {
      ms.setActionHandler('play', () => togglePlay(currentRef.current))
      ms.setActionHandler('pause', () => { if (playing) togglePlay(currentRef.current) })
      ms.setActionHandler('previoustrack', () => stepTrack(-1))
      ms.setActionHandler('nexttrack', () => stepTrack(1))
      ms.setActionHandler('seekbackward', () => skipBy(-10))
      ms.setActionHandler('seekforward', () => skipBy(10))
      ms.setActionHandler('seekto', (d) => { if (d && typeof d.seekTime === 'number') seekTo(d.seekTime) })
    } catch {}
  }, [current, playing, tracks])
  useEffect(() => {
    if (!('mediaSession' in navigator) || !playing) return
    try { navigator.mediaSession.setPositionState?.({ duration: duration || 0, playbackRate: 1, position: Math.min(currentTime, duration || 0) }) } catch {}
  }, [currentTime, duration, playing])
  const isLiked = (track) => liked.some((song) => song.trackId === track.trackId)
  const toggleLike = (track) => {
    const has = liked.some((song) => song.trackId === track.trackId)
    setLiked((old) => has ? old.filter((song) => song.trackId !== track.trackId) : [...old, track])
    pushToast(has ? 'Removed from Liked Songs' : 'Added to Liked Songs')
  }
  const viewingCustom = selectedPlaylist !== 'local' && selectedPlaylist !== 'my' && selectedPlaylist !== 'liked'
  const customViewed = viewingCustom ? playlists.find((item) => item.id === selectedPlaylist) : null
  const isInTarget = (track) => viewingCustom && customViewed
    ? hasTrack(customViewed.tracks, track.trackId)
    : hasTrack(playlist, track.trackId)
  const toggleTrack = (track) => {
    if (viewingCustom && customViewed) {
      const has = hasTrack(customViewed.tracks, track.trackId)
      setPlaylists((old) => old.map((item) => {
        if (item.id !== selectedPlaylist) return item
        return { ...item, tracks: toggleListTrack(item.tracks, track) }
      }))
      pushToast(has ? `Removed from ${customViewed.name}` : `Added to ${customViewed.name}`)
      return
    }
    const has = hasTrack(playlist, track.trackId)
    setPlaylist((old) => toggleListTrack(old, track))
    pushToast(has ? 'Removed from My playlist' : 'Added to My playlist')
  }
  const addTrackTo = (listId, track) => {
    if (!track) return
    const name = listId === 'my' ? 'My playlist' : playlists.find((p) => p.id === listId)?.name || 'playlist'
    if (listId === 'my') setPlaylist((old) => addTrackToList(old, track))
    else setPlaylists((old) => old.map((item) => item.id === listId ? { ...item, tracks: addTrackToList(item.tracks, track) } : item))
    setAddTarget(null)
    pushToast(`Added to ${name}`)
  }
  const removeFromPlaylist = (id) => setPlaylist((old) => removeTrack(old, id))
  const deletePlaylist = (id) => {
    setPlaylists((old) => old.filter((item) => item.id !== id))
    if (selectedPlaylist === id) { setSelectedPlaylist('local'); setActiveTab('Library'); setTracks(localTracks) }
  }
  const requestDelete = (target) => setConfirmDelete(target)
  const confirmRemoval = () => {
    if (!confirmDelete) return
    if (confirmDelete.kind === 'playlist') { deletePlaylist(confirmDelete.id); pushToast(`Deleted “${confirmDelete.label}”`) }
    if (confirmDelete.kind === 'track') {
      if (confirmDelete.playlistId === 'my') removeFromPlaylist(confirmDelete.id)
      else setPlaylists((old) => old.map((item) => item.id === confirmDelete.playlistId ? { ...item, tracks: removeTrack(item.tracks, confirmDelete.id) } : item))
      pushToast(`Removed “${confirmDelete.label}”`)
    }
    setConfirmDelete(null)
  }
  const selectedLibraryTracks = selectedPlaylist === 'local'
    ? localTracks
    : selectedPlaylist === 'liked'
      ? liked
      : playlists.find((item) => item.id === selectedPlaylist)?.tracks || playlist
  const displayedTracks = activeTab === 'Library' ? selectedLibraryTracks : tracks
  const openPlaylist = (id) => { setSelectedPlaylist(id); setActiveTab('Library'); setTracks(id === 'local' ? localTracks : id === 'liked' ? liked : playlists.find((item) => item.id === id)?.tracks || playlist) }
  const createPlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    const created = { id: `playlist-${Date.now()}`, name, description: 'A playlist you made', tracks: [] }
    setPlaylists((old) => [...old, created]); setNewPlaylistName(''); setShowCreatePlaylist(false); setSelectedPlaylist(created.id); setActiveTab('Library'); setTracks([])
    pushToast(`Created “${name}”`)
  }

  return <div className="app-shell">
    {showSplash && <div className="app-splash" role="status" aria-label="Loading abyss"><div className="splash-inner"><div className="splash-brand"><span className="splash-mark"><img src="/branding/abyss-a-simple-1.png" alt="" /></span><span>abyss</span></div></div></div>}
    <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><button className="mobile-menu-button" onClick={() => setMobileNavOpen((open) => !open)} aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}>{mobileNavOpen ? <X size={20}/> : <Menu size={20}/>}</button><span className="brand-mark"><img src="/branding/abyss-a-simple-1.png" alt="" /></span><span>abyss</span>{jamRoom && <button className="jam-pill" onClick={() => { setShowChat(false); setShowJam(true) }}><span className="live-dot" />{jamRoom}</button>}</div>
      <div className="nav-label">YOUR LIBRARY</div>
      <nav className="nav-group library-nav">
        <NavItem icon={<Library size={18} />} label="Local songs" badge={localTracks.length} active={selectedPlaylist === 'local'} onClick={() => { setShowChat(false); openPlaylist('local'); setMobileNavOpen(false) }} />
        <NavItem icon={<Heart size={18} />} label="Liked Songs" badge={liked.length} active={selectedPlaylist === 'liked'} onClick={() => { setShowChat(false); openPlaylist('liked'); setMobileNavOpen(false) }} />
        <NavItem icon={<ListMusic size={18} />} label="My playlist" badge={playlist.length} onClick={() => { setShowChat(false); setShowPlaylist(true); setMobileNavOpen(false) }} />
      </nav>
      <div className="nav-label playlist-label"><span>PLAYLISTS</span><button className="add-playlist-button" onClick={() => setShowCreatePlaylist(true)} aria-label="Create playlist"><Plus size={14} /></button></div>
      <nav className="nav-group library-nav">
        {playlists.map((item) => <div key={item.id} className="playlist-nav-row"><NavItem icon={<Album size={17} />} label={item.name} active={selectedPlaylist === item.id} onClick={() => { setShowChat(false); openPlaylist(item.id); setMobileNavOpen(false) }} /><button className="nav-delete" onClick={() => requestDelete({ kind: 'playlist', id: item.id, label: item.name })} aria-label={`Delete ${item.name}`} title={`Delete ${item.name}`}><Trash2 size={14}/></button></div>)}
      </nav>
      {jamRoom && <><div className="nav-label chat-label">YOUR JAM</div><nav className="nav-group chat-nav"><NavItem icon={<MessageCircle size={18} />} label="Chat" active={showChat} onClick={() => { setShowChat(true); setShowJam(false); setMobileNavOpen(false) }} /></nav></>}
      <div className="sidebar-bottom"><div className="tiny-label">YOUR SPACE</div><button className="space-card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => { setShowChat(false); setShowJam(true); setMobileNavOpen(false) }}><div className="space-glow"><Zap size={18} /></div><div><strong>Jam with a friend</strong><span>{jamRoom ? `● ${jamRoom} · ${jamMembers.length}` : 'Start a room'}</span></div><span className="soon">{jamRoom ? 'LIVE' : 'JAM'}</span></button><div className="sidebar-foot"><span>© 2026 abyss</span><span>v0.1 beta</span></div></div>
    </aside>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

    <main className={'main-content ' + (showChat && jamRoom ? 'chat-open' : '')}>
      {showChat && jamRoom && <section className="chat-page">
        <div className="chat-page-shell">
          <div className="chat-room-meta"><span className="chat-connected"><i className="live-dot" /> {jamMembers.length} connected</span></div>
          <div className="chat-messages" aria-live="polite">
            {!jamMessages.length && <div className="chat-empty"><MessageCircle size={25}/><strong>Start the conversation</strong><span>Suggest a song, say hi, or decide what plays next.</span></div>}
            {jamMessages.map((message, index) => <div className={message.name === jamName ? 'chat-message-row mine' : 'chat-message-row'} key={message.at || index}><div className="chat-message-stack"><strong className="chat-author">{message.name || 'guest'}</strong><div className="chat-bubble">{message.text}</div>{message.at && <span className="chat-time">{new Date(message.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div></div>)}<div ref={chatEndRef} />
          </div>
          <form className="chat-composer" onSubmit={sendJamChat}><input value={jamDraft} onChange={(e) => setJamDraft(e.target.value)} maxLength={280} placeholder="Write a message…" aria-label="Message your friend" /><button type="submit" disabled={!jamDraft.trim()} aria-label="Send message"><Send size={16} /></button></form>
        </div>
      </section>}
      {!query && activeTab !== 'Library' && <div className="mobile-home-heading"><h1>Find your next <em>favorite.</em></h1></div>}
      <SearchBar
        query={query}
        suggestions={suggest}
        suggestionIndex={suggestIdx}
        suggestionsOpen={suggestOpen}
        onChange={handleSearchInput}
        onKeyDown={handleSearchKeyDown}
        onPick={pickSuggest}
        onHover={setSuggestIdx}
        onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
        onClear={() => search('')}
      />
      {!query && activeTab !== 'Library' && <p className="mobile-home-quote">“And if you gaze long into an abyss, the abyss also gazes into you.”</p>}
      <section className={`welcome-row ${activeTab === 'Library' ? '' : 'home-welcome'}`}><div><h1>{activeTab === 'Library' ? selectedPlaylist === 'local' ? 'Local songs' : <>{selectedPlaylist === 'liked' ? 'Liked Songs' : playlists.find((item) => item.id === selectedPlaylist)?.name || 'Local songs'} <em>collection.</em></> : <>Find your next <em>favorite.</em></>}</h1>{activeTab === 'Library' && !viewingCustom && selectedPlaylist !== 'local' && <p>{selectedPlaylist === 'liked' ? 'Every song you’ve hearted, in one place.' : playlists.find((item) => item.id === selectedPlaylist)?.description}</p>}</div>{activeTab === 'Library' && viewingCustom && <button className="text-button" onClick={() => requestDelete({ kind: 'playlist', id: selectedPlaylist, label: playlists.find((item) => item.id === selectedPlaylist)?.name })}><Trash2 size={14}/> Delete playlist</button>}</section>
      {activeTab === 'Library' && <div className="lib-chips">
        <button className={`chip ${selectedPlaylist === 'local' ? 'active' : ''}`} onClick={() => openPlaylist('local')}>Local</button>
        <button className={`chip ${selectedPlaylist === 'liked' ? 'active' : ''}`} onClick={() => openPlaylist('liked')}>Liked</button>
        <button className="chip" onClick={() => setShowPlaylist(true)}>My playlist</button>
        {playlists.map((p) => <button key={p.id} className={`chip ${selectedPlaylist === p.id ? 'active' : ''}`} onClick={() => openPlaylist(p.id)}>{p.name}</button>)}
        <button className="chip new" onClick={() => setShowCreatePlaylist(true)} aria-label="New playlist"><Plus size={14}/></button>
      </div>}
      <section className={`section-head ${!query && activeTab !== 'Library' ? 'home-section-head' : ''}`}><div><h3>{query ? `Results for “${query}”` : activeTab === 'Library' ? `${selectedLibraryTracks.length} song${selectedLibraryTracks.length === 1 ? '' : 's'}` : 'Made for this moment'}</h3>{activeTab === 'Library' && !query && <p>Your saved music, ready whenever you are.</p>}</div></section>
      <section className={`track-grid ${!query && activeTab !== 'Library' ? 'home-track-grid' : ''}`}>{adInfo && <div className="ad-banner"><span className="ad-pill"><span className="live-dot" />AD</span><div className="ad-copy"><strong>{adInfo.title}</strong>{adInfo.author && <span>{adInfo.author}</span>}</div></div>}{searchError && !loading && <div className="empty">{searchError}</div>}{loading ? <div className="loading"><LoaderCircle className="spin" size={22}/> Finding something good...</div> : displayedTracks.slice(0, activeTab === 'Library' ? displayedTracks.length : 6).map((track) => <TrackCard key={track.trackId} track={track} current={current} playing={playing} onPlay={() => togglePlay(track)} onAdd={() => {
              if (isInTarget(track)) {
                if (viewingCustom) requestDelete({ kind: 'track', id: track.trackId, label: track.trackName, playlistId: selectedPlaylist })
                else toggleTrack(track)
              } else if (viewingCustom) toggleTrack(track)
              else setAddTarget(track)
            }} inPlaylist={isInTarget(track)} isRemove={viewingCustom && isInTarget(track)} onLike={() => toggleLike(track)} isLiked={isLiked(track)} />)}{!loading && !searchError && !displayedTracks.length && <div className="empty">No tracks found. Try another artist or song.</div>}</section>
    </main>

    <div className={adInfo ? 'ad-holder' : 'yt-holder'} aria-hidden={!adInfo}>
      {adInfo && <div className="ad-tag">AD · your song resumes after</div>}
      <div id="jam-yt-player" />
    </div>
    <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'error' ? <X size={14}/> : <Check size={14}/>}<span>{t.msg}</span></div>)}</div>
    <footer className="player"><div className="now-playing"><span className="art-wrap"><img src={current.artworkUrl100}/><button className={isLiked(current) ? 'liked' : ''} onClick={() => toggleLike(current)} aria-label={isLiked(current) ? 'Unlike' : 'Like'} title={isLiked(current) ? 'Unlike' : 'Like'}><Heart size={13} fill={isLiked(current) ? 'currentColor' : 'none'} /></button></span><div><strong>{current.trackName}</strong><span>{formatSeconds(currentTime)} / {formatSeconds(duration)}</span></div></div><div className="player-controls"><div className="control-buttons"><button onClick={() => skipBy(-10)} aria-label="Skip back 10 seconds"><SkipBack size={17} fill="currentColor" /></button><button className="play-button" onClick={() => togglePlay(current)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button onClick={() => skipBy(10)} aria-label="Skip forward 10 seconds"><SkipForward size={17} fill="currentColor" /></button></div><div className="progress"><span>{formatSeconds(currentTime)}</span><input className="progress-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(e) => seekTo(e.target.value)} aria-label="Seek through song"/><span>{formatSeconds(duration)}</span></div></div><div className="player-right"><Volume2 size={17}/><input className="volume-range" type="range" min="0" max="1" step="0.01" defaultValue="1" onChange={(e) => { const v = Number(e.target.value); if (audioRef.current) audioRef.current.volume = v; try { ytRef.current.player?.setVolume(Math.round(v * 100)) } catch {} }} aria-label="Volume"/></div></footer>
    {showPlaylist && <div className="modal-backdrop" onClick={() => setShowPlaylist(false)}><section className="playlist-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">YOUR LIBRARY</div><h2>My playlist <span>{playlist.length}</span></h2></div><button className="icon-button" onClick={() => setShowPlaylist(false)}><X size={20}/></button></div><div className="modal-list">{!playlist.length && <div className="empty" style={{ margin: 12 }}>Nothing here yet — hit + on any song to add it.</div>}{playlist.map((track) => <div className="modal-track" key={track.trackId}><img src={track.artworkUrl100}/><div className="modal-copy"><strong>{track.trackName}</strong></div><button onClick={() => togglePlay(track)}>{playing && current.trackId === track.trackId ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="remove-button" onClick={() => requestDelete({ kind: 'track', id: track.trackId, label: track.trackName, playlistId: 'my' })}><Trash2 size={15}/></button></div>)}</div><div className="modal-footer"><button className="primary-button small" onClick={() => { setShowPlaylist(false); document.querySelector('.search-wrap input')?.focus() }}><Plus size={15}/> Add songs</button></div></section></div>}
    {confirmDelete && <div className="confirm-backdrop" onClick={() => setConfirmDelete(null)}><section className="confirm-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}><div className="confirm-icon"><Trash2 size={19}/></div><div><h2>{confirmDelete.kind === 'playlist' ? 'Delete this playlist?' : 'Remove this song?'}</h2><p>{confirmDelete.kind === 'playlist' ? `“${confirmDelete.label}” and its songs will be removed.` : `Remove “${confirmDelete.label}” from this playlist?`}</p></div><div className="confirm-actions"><button className="text-button" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="danger-button" onClick={confirmRemoval}>Delete</button></div></section></div>}
    {addTarget && <div className="modal-backdrop" onClick={() => setAddTarget(null)}><section className="create-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">ADD TO PLAYLIST</div><h2 className="pick-title">{addTarget.trackName}</h2></div><button className="icon-button" onClick={() => setAddTarget(null)}><X size={20}/></button></div><div className="create-body"><div className="pick-list"><button className="pick-item" onClick={() => addTrackTo('my', addTarget)}><span><ListMusic size={16}/> My playlist</span><small>{playlist.length}</small></button>{playlists.map((p) => <button key={p.id} className="pick-item" onClick={() => addTrackTo(p.id, addTarget)}><span><Album size={16}/> {p.name}</span><small>{p.tracks.length}</small></button>)}</div></div></section></div>}
    {showCreatePlaylist && <div className="modal-backdrop" onClick={() => setShowCreatePlaylist(false)}><section className="create-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">NEW PLAYLIST</div><h2>Create a playlist</h2></div><button className="icon-button" onClick={() => setShowCreatePlaylist(false)}><X size={20}/></button></div><div className="create-body"><label htmlFor="playlist-name">Playlist name</label><input id="playlist-name" autoFocus value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createPlaylist()} placeholder="e.g. songs for the drive"/><div className="create-actions"><button className="text-button" onClick={() => setShowCreatePlaylist(false)}>Cancel</button><button className="primary-button small" onClick={createPlaylist}><Plus size={15}/> Create playlist</button></div></div></section></div>}
    {showJam && <div className="modal-backdrop" onClick={() => setShowJam(false)}><section className="create-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="overline">LISTEN TOGETHER</div><h2>Jam {jamRoom && <span>● {jamRoom}</span>}</h2></div><button className="icon-button" onClick={() => setShowJam(false)}><X size={20}/></button></div><div className="create-body">
      {!jamRoom ? <>
        <label htmlFor="jam-name">Your name</label><input id="jam-name" value={jamName} onChange={(e) => setJamName(e.target.value)} placeholder="e.g. hardi" style={{ marginBottom: 14 }} />
        <label htmlFor="jam-code">Room code (ask your friend for theirs)</label><input id="jam-code" value={jamRoomInput} onChange={(e) => setJamRoomInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && joinJam(jamRoomInput)} placeholder="e.g. KQ4M" style={{ marginBottom: 14 }} />
       <div className="create-actions"><button className="text-button" onClick={() => { const code = createRoomCode(); setJamRoomInput(code); joinJam(code, true) }}>Create new room</button><button className="primary-button small" onClick={() => joinJam(jamRoomInput)}><Zap size={15}/> Join jam</button></div>
      </> : <>
        <label>Who's in ({jamMembers.length})</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{jamMembers.map((m) => <span key={m} className="status-pill"><span className="status-dot"/>{m}</span>)}</div>
        <label>Share this code with your friend</label><input readOnly value={jamRoom} onFocus={(e) => e.target.select()} style={{ marginBottom: 14, fontWeight: 800, letterSpacing: '.1em' }} />
        <div className="create-actions"><button className="text-button" onClick={leaveJam}>Leave</button><button className="primary-button small" onClick={() => { broadcastJam(); setShowJam(false) }}><Play size={15}/> Sync now</button></div>
      </>}
      {jamStatus && <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 14 }}>{jamStatus}</p>}
    </div></section></div>}
    <nav className={`mobile-tabs ${jamRoom ? 'has-chat' : ''}`}>
      <button className={activeTab === 'Discover' ? 'active' : ''} onClick={() => { setShowChat(false); setActiveTab('Discover'); setQuery(''); search(''); window.scrollTo({ top: 0 }) }}><Home size={22}/><span>Home</span></button>
      <button className={activeTab === 'Library' ? 'active' : ''} onClick={() => { setShowChat(false); if (activeTab !== 'Library') openPlaylist('local'); window.scrollTo({ top: 0 }) }}><Library size={22}/><span>Library</span></button>
      <button className={jamRoom ? 'live' : ''} onClick={() => { setShowChat(false); setShowJam(true) }}><Zap size={22}/><span>Jam</span>{jamRoom && <i className="live-dot" />}</button>
      {jamRoom && <button className={showChat ? 'active' : ''} onClick={() => { setShowChat(true); setShowJam(false) }}><MessageCircle size={22}/><span>Chat</span></button>}
    </nav>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
