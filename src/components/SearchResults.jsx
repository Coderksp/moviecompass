import { motion } from 'framer-motion'
import MovieCard from './MovieCard'
import { IMG, INDUSTRIES, CREDIT_ORDERS } from '../api/tmdb'

export default function SearchResults({
  query, results, people = [], person, stats, onPerson, onClearPerson,
  industry = 'all', onIndustry,
  decades = [], creditTotal = 0, decade = null, onDecade, order = 'known', onOrder,
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

      {/* A career is long enough that "everything, most famous first" stops
          being a useful way to look at it. Only shown for an actor, and only
          once there is more than one decade to choose between. */}
      {person && decades.length > 1 && (
        <CareerFilters
          decades={decades}
          decade={decade}
          onDecade={onDecade}
          order={order}
          onOrder={onOrder}
          total={creditTotal}
        />
      )}

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

// Decade and order, for a filmography.
//
// The decade chips carry their counts because the counts are the interesting
// part — they show the shape of a career at a glance, where the working years
// were and where they thinned out, before anything is clicked.
//
// "All" is given the real number of credits rather than the sum of the decades,
// and the difference is not always zero: a credit with no release date belongs
// to no decade but is still shown under All. Adding the chips up gave Ajith
// Kumar "All 60" above sixty-two films, which is the kind of number somebody
// checks once, disbelieves, and then stops trusting the rest of the page over.
function CareerFilters({ decades, decade, onDecade, order, onOrder, total }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <Row label="Decade">
        <Chip on={decade === null} onClick={() => onDecade(null)}>
          All <Count on={decade === null}>{total}</Count>
        </Chip>
        {decades.map((d) => (
          <Chip key={d.decade} on={decade === d.decade} onClick={() => onDecade(d.decade)}>
            {d.label} <Count on={decade === d.decade}>{d.count}</Count>
          </Chip>
        ))}
      </Row>

      <Row label="Order">
        {CREDIT_ORDERS.map((o) => (
          <Chip key={o.id} on={order === o.id} onClick={() => onOrder(o.id)}>
            {o.label}
          </Chip>
        ))}
      </Row>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{
        fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--text-dim)', margin: '0 0 7px', opacity: 0.8,
      }}>
        {label}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Chip({ on, children, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 600,
        color: on ? '#fff' : 'var(--text-dim)',
        background: on
          ? 'linear-gradient(100deg, var(--magenta), var(--violet))'
          : 'rgba(26,16,41,0.7)',
        border: on ? '1px solid transparent' : '1px solid rgba(168,85,247,0.25)',
        transition: 'color .2s, background .2s, border-color .2s',
      }}
    >
      {children}
    </button>
  )
}

// Dimmed against its own chip rather than coloured separately, so the count
// reads as part of the label instead of competing with it.
function Count({ on, children }) {
  return (
    <span style={{ opacity: on ? 0.75 : 0.6, fontWeight: 500 }}>{children}</span>
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
