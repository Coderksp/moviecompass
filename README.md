# 🎬 moviecompass — Movie Discovery App

A colorful, animated movie discovery web app where **trailers play inline when you hover over a film**. Browse trending picks, search 600,000+ titles, and watch previews without ever leaving the page.

> Built with React, Vite, Framer Motion, and the TMDB API.

🔗 Live demo:https://reelix-f4l5-5gl8u8ka0-sugan2.vercel.app/#trending

![Reelix preview]<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/063de290-66c9-4a9f-8ee9-9dc0d2424fa8" />
)

---

## ✨ Features

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
| Styling | Hand-written CSS (no UI library) |
| Deploy | Vercel |

## 🚀 Getting started

### 1. Clone and install
```bash
git clone https://github.com/Coderksp/reelix.git
cd reelix
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
VITE_TMDB_API_KEY=your_key_here
```

### 3. Run it
```bash
npm run dev
```
Open the local URL Vite prints (usually `http://localhost:5173`).

## ☁️ Deploy to Vercel (free)

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com), import the repo.
3. Under **Environment Variables**, add `VITE_TMDB_API_KEY` with your key.
4. Deploy. Vercel auto-detects Vite — no extra config needed.

## 📁 Project structure

```
src/
├── api/tmdb.js          # TMDB client: categories, featured, trailers, search
├── components/
│   ├── Navbar.jsx       # Logo + debounced live search
│   ├── Hero.jsx         # Featured film with staggered entrance
│   ├── Row.jsx          # Horizontal scrolling rail
│   ├── MovieCard.jsx    # ⭐ Hover-to-play trailer card (the core feature)
│   └── SearchResults.jsx
├── App.jsx              # Layout + data loading
└── index.css           # Theme tokens + ambient background
```

## 💡 How hover-to-play works

When the mouse enters a card, a 600 ms timer starts (so quickly scanning across posters doesn't trigger every trailer). If the mouse stays, the app fetches that movie's trailer key from `GET /movie/{id}/videos`, then fades in a muted, looping, controls-free YouTube embed scaled to fill the card. Trailer keys are cached so re-hovering is instant.

## 📝 License

MIT — free to use, learn from, and build on.

---

Built by **Suganprasath K** · [GitHub](https://github.com/Coderksp) · [LinkedIn](https://linkedin.com/in/suganprasathkrishnamoorthy)
