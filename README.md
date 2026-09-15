# 🧭 Movie Compass — Movie Discovery App

A colorful, animated movie discovery web app where **trailers play inline when you hover over a film**. Browse trending picks, search 600,000+ titles, and watch previews without ever leaving the page.

> Built with React, Vite, Framer Motion, and the TMDB API.

🔗 Live demo: https://moviecompassf.vercel.app/

![MovieCompass preview]<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/063de290-66c9-4a9f-8ee9-9dc0d2424fa8" />
)

---

## ✨ Features

- **"More like this"** — open any title and the app works out what to watch next, and tells you *why* in one line under each poster.
- **"For you"** — sign in and the home page leads with a rail built from a model of your own taste, each pick captioned with the reason it is there.
- **Profiles** — your name and picture, your counts, and a readable breakdown of the genres, languages and film-makers your recommendations are built from.
- **Hover-to-play trailers** — hover any movie poster and its YouTube trailer fades in and plays, muted and looping, right inside the card.
- **Live search** — debounced search across the full TMDB catalogue with an animated results grid.
- **Curated rails** — trending, critically acclaimed, action, sci-fi, comedy, horror and more, each in a smooth horizontal scroller.
- **Animated everything** — staggered entrance animations, scroll-triggered reveals, an ambient drifting-colour background, and micro-interactions throughout (Framer Motion).
- **Responsive + accessible** — works down to mobile, keyboard-focusable, and respects `prefers-reduced-motion`.

## 🛠 Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite |
| Animation | Framer Motion |
| Data | TMDB REST API |
| Recommendations | Own hybrid ranker + Claude for the captions |
| Styling | Hand-written CSS (no UI library) |
| Deploy | Vercel |

## 🚀 Getting started

### 1. Clone and install
```bash
git clone https://github.com/Coderksp/moviecompass.git
cd moviecompass
npm install
```

### 2. Get a free TMDB API key
1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup)
2. Go to **Settings → API** and request an API key (v3 auth)
3. Copy `.env.example` to `.env` and paste your key:
```bash
cp .env.example .env
```
```
TMDB_API_KEY=your_key_here
```
No `VITE_` prefix. Anything prefixed that way is substituted into the browser
bundle at build time, which would publish the key to every visitor — the key is
read by the serverless proxy in `/api` and stays on the server.

### 3. Run it
```bash
npm run dev
```
Open the local URL Vite prints (usually `http://localhost:5173`).

## ☁️ Deploy to Vercel (free)

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com), import the repo.
3. Under **Environment Variables**, add the ones you need:

| Variable | Needed? | What it does |
|---|---|---|
| `TMDB_API_KEY` | **Required** | Film data. Everything is blank without it. |
| `SESSION_SECRET` | For accounts | Signs session cookies. 32+ characters. |
| `DATABASE_URL` | For accounts | Neon Postgres, for watchlists and ratings. |
| `ANTHROPIC_API_KEY` | Optional | Writes the captions under "More like this". Without it they are assembled from the matched features instead — plainer, never wrong, and the recommendations themselves are identical. |
| `OMDB_API_KEY` | Optional | Ranks an actor's films by IMDb rating rather than TMDB's. |

4. Deploy. Vercel auto-detects Vite — no extra config needed.

Everything optional degrades quietly rather than breaking a page, so it is fine
to deploy with only `TMDB_API_KEY` and add the rest later.

## 📁 Project structure

```
src/
├── api/tmdb.js          # TMDB client: categories, featured, trailers, search
├── api/recommend.js     # Client for the recommendation endpoint
├── api/profile.js       # Client for the profile and "for you" endpoints
├── components/
│   ├── Navbar.jsx       # Logo + debounced live search
│   ├── Hero.jsx         # Featured film with staggered entrance
│   ├── Row.jsx          # Horizontal scrolling rail
│   ├── MovieCard.jsx    # ⭐ Hover-to-play trailer card (the core feature)
│   ├── SimilarTitles.jsx # "More like this" rail inside the modal
│   ├── ForYouRow.jsx    # The curated home-page rail
│   ├── Profile.jsx      # Profile screen + taste breakdown
│   └── SearchResults.jsx
├── App.jsx              # Layout + data loading
└── index.css           # Theme tokens + ambient background
```

## 🧠 How "More like this" works

Open a film and the rail underneath it is built fresh by `/api/similar`. There is
no pre-computed table of neighbours and no third-party recommendation service —
the ranking is done by `api/_lib/recommend.js`, in four steps.

**1. Candidate generation.** Five queries run in parallel, each wrong in its own
way. TMDB's recommendations know what audiences watched next but nothing about a
film nobody has watched yet. A keyword search knows the premise but rates a
cheap imitation alongside the original. Director, cast and same-language sweeps
find the people and the industry but not the story. Their ranked lists are
combined by **reciprocal rank fusion**, which needs no agreement about what the
scores mean — only about where each title placed. Something that turns up
mid-table in three lists beats something that topped one and appeared nowhere
else.

Which keywords get searched is decided by measurement, not by reading them.
Every candidate keyword is checked for how many titles carry it, because that is
not guessable: Inception's "high concept" is 9 films and its "kidnapping" is
1,525, and searching the second one returns the popularity chart.

**2. Coarse ranking.** Everything in the pool is scored on what a list response
already contains — genre overlap, era, language, audience score — and cut to a
shortlist, with slots reserved so every generator gets a hearing.

**3. Fine ranking.** The shortlist gets one full metadata lookup each, then is
re-scored on what actually decides similarity: IDF-weighted keyword cosine,
cast and crew overlap, TF-IDF over the synopsis, era, language and a
public-opinion prior. Anything that matched on genre and popularity alone is
dropped here — both because it is a weak recommendation and because the app
would have nothing honest to say about it.

**4. Diversity.** A plain score ranking returns the same franchise five times
over, since every sequel genuinely *is* the most similar thing. **Maximal
marginal relevance** makes each pick clear a higher bar the more it resembles
what has already been chosen, so the second film by the same director has to
earn its place.

Every title then gets a one-line reason, assembled from the features that
actually fired — so it can never claim a connection the model did not score. Set
`ANTHROPIC_API_KEY` and **Claude** rewrites those into something readable, given
only the connections already found rather than being asked what is similar. With
no key the plainer version ships and nothing else changes.

## 👤 How "For you" works

The same engine, asked a different question. `/api/similar` compares candidates
against one film; `/api/for-you` compares them against *you*.

Your library is collapsed into a single weighted taste profile. The signals are
not equal and are not all positive: a favourite counts full, a rating scales from
+1 at 10 down through neutral at 6 to a **negative** weight below that, and a
watchlist entry counts least, because it records intent rather than a verdict —
nobody has watched it yet.

Your four strongest titles then seed the same five candidate generators, tagged
so each result remembers which of your films led to it. That provenance is what
makes the caption specific: *"Lokesh Kanagaraj, who made Vikram"* rather than
*"you might like this"*. Candidates are scored against the whole profile —
keyword, people, genre, language, era and audience affinity — and anything you
have already saved, rated or watched is removed.

Every caption names the title a person is actually in, looked up rather than
assumed. An earlier version paired the top-rated film with whichever actor
matched and confidently reported *"Laurence Fishburne, as in Inception"*.

Your profile screen shows the resulting model back to you — the genres,
languages, film-makers and era it learned — because a recommender that will not
show its reasoning is asking to be trusted for nothing.

## 💡 How hover-to-play works

When the mouse enters a card, a 600 ms timer starts (so quickly scanning across posters doesn't trigger every trailer). If the mouse stays, the app fetches that movie's trailer key from `GET /movie/{id}/videos`, then fades in a muted, looping, controls-free YouTube embed scaled to fill the card. Trailer keys are cached so re-hovering is instant.

## 📝 License

MIT — free to use, learn from, and build on.

---

Built by **Suganprasath K** · [GitHub](https://github.com/Coderksp) · [LinkedIn](https://linkedin.com/in/suganprasathkrishnamoorthy)
