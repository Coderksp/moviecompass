# 🧭 Movie Compass — To-Do / Feature Roadmap

A running list of features and improvements for Movie Compass. Grouped by theme; check items off as they ship.

---

## ✅ Shipped, but never on this list

Things that turned out to be needed once the app met the real world.

- [x] **Serverless proxy for TMDB** — some ISPs (Jio, Airtel) block `themoviedb.org` outright, so a browser-side call fails for a large share of Indian visitors. Requests now go through Vercel, which also took the API key out of the bundle.
- [x] **Image proxy** — `image.tmdb.org` is blocked on the same networks, so posters needed the same treatment.
- [x] **Rebrand to Movie Compass** — compass-needle mark that doubles as a play triangle, two-line wordmark lockup.
- [x] **Browse by industry** — Hollywood, Bollywood, Kollywood, Tollywood, Mollywood, Sandalwood, Korean, Japanese. Maps onto a title's original language.
- [x] **Browse by cast** — pick an actor and see their filmography; composes with industry and media type.
- [x] **Actor career stats** — film and series counts plus a "fan favourite" ranking weighted by how many people voted, not just the average.
- [x] **Real accounts** — Postgres on Neon, bcrypt at cost 12, sessions as httpOnly cookies, rate-limited login.
- [x] **Google sign-in** — authorization-code flow with PKCE and id_token signature verification.
- [x] **Trailer language fix** — TMDB filters videos to English by default, so regional films appeared to have no trailer at all.

---

## 🔍 Discovery & Browsing
- [ ] **Genre filter chips** — filterable pills above the rails to jump to a genre.
- [ ] **Sort controls** — sort rails/search by popularity, rating, release date, or A–Z.
- [ ] **Advanced filters** — year range, minimum rating, runtime. *(Language shipped; the rest have not.)*
- [ ] **"Because you watched…" rail** — recommendations based on the last movie viewed.
- [ ] **Infinite scroll / "Load more"** on rails and search results. *(Browse grids are capped at one page.)*
- [ ] **Trending toggle** — switch between "Trending today" and "Trending this week".
- [x] **TV shows** — extend beyond movies to include series (TMDB `/tv` endpoints).
- [x] **Person pages** — click an actor/director to see their filmography.

## ❤️ Personalization
- [x] **Watchlist** — save titles to a personal list. *(Postgres rather than `localStorage`, so it follows you between devices.)*
- [x] **Favorites / likes** — heart a title and see a "Your favourites" rail.
- [ ] **"Seen it" tracking** — mark titles watched and dim them in rails.
- [x] **User ratings** — rate on your own 1–10 scale.
- [ ] **Continue browsing** — remember scroll position and last-viewed titles.
- [ ] **Rank an actor's films by _your_ ratings** — the data is already stored; the ranking still uses TMDB's public score.

## 🎥 Movie Detail & Media
- [x] **Full trailer modal** — click to open the trailer full-size with sound.
- [x] **Cast & crew** in the detail modal, with photos, each opening that person's filmography.
- [ ] **Similar / recommended** titles inside the modal.
- [ ] **Backdrop gallery** — swipeable stills and posters.
- [x] **Where to watch** — watch-provider logos per region, with a country picker.
- [x] **Reviews** — top TMDB user reviews in the modal.
- [ ] **Runtime, budget, revenue, and tagline** metadata. *(Runtime, seasons and tagline shipped; budget and revenue have not.)*

## 🎨 UI / UX
- [ ] **Light / dark theme toggle** (currently dark-only).
- [ ] **Skeleton loaders** instead of the "Loading more titles…" text.
- [ ] **Keyboard navigation** — arrow keys to move through a rail. *(`Esc` closes modals and `/` focuses search already.)*
- [ ] **Search history & recent searches** dropdown.
- [ ] **Empty-state art** when a search returns no results.
- [ ] **Scroll-to-top button** and rail arrow buttons for non-touch devices.
- [ ] **Shareable links** — deep-link to a title (`/movie/:id`) so a modal opens on load. *(Needs a router; the app has none.)*

## ⚡ Performance & Quality
- [ ] **Image lazy-loading** — `loading="lazy"` is in place; blur-up placeholders are not.
- [ ] **Debounce & cancel** in-flight search requests (AbortController). *(Debounced, not cancelled.)*
- [x] **Cache API responses** — details, trailers, providers and credits are cached in memory and at the edge.
- [x] **Move the TMDB key server-side** — proxied, so the key is never in the client bundle.
- [ ] **Error boundaries** and graceful retry on failed fetches.
- [ ] **Unit tests** for the `tmdb.js` API layer (Vitest). *(Auth, OAuth, the proxy and the library store have ad-hoc test scripts; none are in the repo.)*
- [ ] **PWA support** — installable, offline shell, app icon.

## ♿ Accessibility & SEO
- [ ] **Focus traps** in the modal and proper ARIA roles.
- [x] **Alt text** on poster/backdrop images.
- [ ] **Meta tags & Open Graph** for rich link previews.
- [ ] **Reduced-data mode** — disable auto-playing trailers on slow connections.

## 🌐 Nice-to-haves
- [ ] **Facebook sign-in** — same shape as Google, but needs a privacy policy and app review first.
- [ ] **Multi-language UI** and localized TMDB metadata.
- [x] **Region selector** for watch providers.
- [ ] **"Surprise me"** — random title button.
- [ ] **Analytics** — track which rails and titles get the most engagement.
