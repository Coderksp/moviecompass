import { motion } from 'framer-motion'
import MovieCard from './MovieCard'
import { IMG, INDUSTRIES } from '../api/tmdb'

export default function SearchResults({
  query, results, people = [], person, stats, onPerson, onClearPerson,
  industry = 'all', onIndustry,
}) {
  return (
    <section style={{ padding: '6.5rem clamp(1rem, 4vw, 3rem) 3rem', minHeight: '80vh' }}>
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: 'clamp(1.4rem, 3vw, 2.2rem)', marginBottom: 6,
        }}
      >
        {person ? (
          <>Starring <span className="grad-text">{person.name}</span></>
        ) : (
          <>Results for <span className="grad-text">“{query}”</span></>
        )}

      </motion.h2>

      {person && (
        <button
          onClick={onClearPerson}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: 'var(--cyan)', fontSize: 13.5, marginBottom: 18,
          }}
        >
          {/* Arriving from a film's cast means there is no search to go back to. */}
          {query.trim() ? `← Back to results for “${query}”` : '← Back to browsing'}
        </button>
      )}

      {person && stats && <ActorStats person={person} stats={stats} />}

      {/* The industry chips used to live here. They moved to the filter bar so
          they can be browsed with rather than only narrowing an existing search;
          duplicating them would give two controls for one piece of state. */}

      {/* Matching actors, offered before the titles — searching a name usually
          means "what else are they in", which a title grid can't answer. */}
      {!person && people.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.09em',
            color: 'var(--text-dim)', marginBottom: 12,
          }}>
            People
          </h3>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => onPerson(p)}
                style={{
                  flex: '0 0 auto', width: 108, background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0, textAlign: 'center', color: 'inherit',
                }}
              >
                <span style={{
                  display: 'block', width: 84, height: 84, margin: '0 auto 8px',
                  borderRadius: '50%', overflow: 'hidden', background: 'var(--surface)',
                  border: '1px solid rgba(168,85,247,0.3)',
                }}>
                  {p.profile_path && (
                    <img
                      src={IMG(p.profile_path, 'w185')}
                      alt={p.name}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block', lineHeight: 1.25 }}>
                  {p.name}
                </span>
                {p.knownFor.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginTop: 2 }}>
                    {p.knownFor.join(', ')}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 16 }}>
          {industry === 'all'
            ? 'Nothing found. Try another title or name.'
            : `Nothing here from ${INDUSTRIES.find((i) => i.id === industry)?.label}. Try “All”.`}
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 18,
          }}
        >
          {results.map((m, i) => (
            <MovieCard key={`${m.mediaType}-${m.id}`} movie={m} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

// Career totals plus the actor's best-rated film. "Best" is a vote-weighted
// score, not the raw rating — see personStats for why.
function ActorStats({ person, stats }) {
  const { movies, series, best, rating, votes, source } = stats
  const year = best?.release_date ? best.release_date.slice(0, 4) : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        background: 'var(--bg-soft)', border: '1px solid rgba(168,85,247,0.18)',
        borderRadius: 16, padding: 20, marginBottom: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {person.profile_path && (
          <img
            src={IMG(person.profile_path, 'w185')}
            alt=""
            width={64}
            height={64}
            style={{
              borderRadius: '50%', objectFit: 'cover', flex: 'none',
              border: '1px solid rgba(168,85,247,0.35)',
            }}
          />
        )}
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: 24, letterSpacing: '-0.03em', lineHeight: 1.05,
        }}>
          {person.name}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', marginTop: 16 }}>
        <Stat value={movies} label="Films" grad />
        <Stat value={series} label="Series" grad />
        {best && (
          <>
            <Stat
              value={
                <>
                  {rating.toFixed(1)}
                  <span style={{ fontSize: 15, color: 'var(--text-dim)', fontWeight: 600 }}>
                    /10
                  </span>
                </>
              }
              // Naming the source and the vote count is what makes the ranking
              // legible — it shows why this film won rather than asserting it.
              label={`${source} rating`}
              color="var(--amber)"
            />
            <div style={{ flex: 1, minWidth: 190 }}>
              <div style={{ fontWeight: 650, fontSize: 15, marginTop: 2 }}>{best.title}</div>
              <div style={statLabel}>
                Fan favourite{year ? ` · ${year}` : ''}
                {votes ? ` · ${votes.toLocaleString()} votes` : ''}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

function Stat({ value, label, grad, color }) {
  return (
    <div>
      <div
        className={grad ? 'grad-text' : undefined}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30,
          letterSpacing: '-0.03em', lineHeight: 1, color,
        }}
      >
        {value}
      </div>
      <div style={statLabel}>{label}</div>
    </div>
  )
}

const statLabel = {
  fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 600,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--text-dim)', marginTop: 4,
}
