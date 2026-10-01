import {
  Heart, Plus, Search, Trash2, X,
} from 'lucide-react'

export function NavItem({ icon, label, active, badge, onClick }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
    {icon}
    <span>{label}</span>
    {badge > 0 && <small>{badge}</small>}
  </button>
}

export function TrackCard({ track, current, playing, onPlay, onAdd, inPlaylist, isRemove, onLike, isLiked }) {
  const isCurrent = current.trackId === track.trackId
  const playLabel = playing && isCurrent ? 'Pause' : 'Play'
  const addLabel = isRemove ? 'Remove from playlist' : inPlaylist ? 'Remove from My playlist' : 'Add to playlist'

  const stopClick = (event) => event.stopPropagation()

  return <article className={`track-card ${isCurrent ? 'selected' : ''}`}>
    <div className="cover-wrap" onClick={onPlay} role="button" aria-label={playLabel} title={playLabel}>
      <img src={track.artworkUrl100?.replace('100x100', '300x300')} alt="" />
      {playing && isCurrent && <span className="playing-bars"><i /><i /><i /></span>}
    </div>
    <div className="track-meta">
      <div className="track-title">{track.trackName}</div>
      <div className="track-bottom">
        <button className={isLiked ? 'liked' : ''} onClick={(event) => { stopClick(event); onLike() }} aria-label={isLiked ? 'Unlike' : 'Like'} title={isLiked ? 'Unlike' : 'Like'}>
          <Heart size={15} fill={isLiked ? 'currentColor' : 'none'} />
        </button>
        <button className={inPlaylist ? 'added' : ''} onClick={(event) => { stopClick(event); onAdd() }} aria-label={addLabel} title={addLabel}>
          {isRemove ? <Trash2 size={16} /> : inPlaylist ? <Heart size={15} fill="currentColor" /> : <Plus size={16} />}
        </button>
      </div>
    </div>
  </article>
}

export function SearchBar({ query, suggestions, suggestionIndex, suggestionsOpen, onChange, onKeyDown, onPick, onHover, onBlur, onClear }) {
  return <header className="topbar">
    <div className="search-wrap">
      <Search size={18} />
      <input
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder="Search artists, songs, albums..."
      />
      {query && <button className="clear-search" onClick={onClear} aria-label="Clear search"><X size={15} /></button>}
      {suggestionsOpen && suggestions.length > 0 && <div className="suggest-list">
        {suggestions.map((suggestion, index) => <button
          key={suggestion}
          className={index === suggestionIndex ? 'active' : ''}
          onMouseDown={(event) => { event.preventDefault(); onPick(suggestion) }}
          onMouseEnter={() => onHover(index)}
        >
          <Search size={14} />
          <span>{suggestion}</span>
        </button>)}
      </div>}
    </div>
  </header>
}
