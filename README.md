# Music Craft

Infinite Craft-style music discovery app. Combine genres and artists to discover new music at their intersection.

## How it works

- Drag genres/artists onto the canvas
- Bring two elements close together to combine them
- Genre + Genre = new Genre
- Genre + Artist = new Artist
- Artist + Artist = new Artist
- Click any artist to see their Last.fm info

## Tech Stack

- **Frontend**: Svelte 5, Vite
- **Backend**: Bun, Hono, Drizzle ORM
- **Database**: SQLite
- **APIs**: OpenRouter (Claude Haiku 4.5), Last.fm

## Setup

```bash
# Backend
cd backend
bun install
cp .env.example .env  # add your API keys
bun run src/db/seed.ts
bun run src/index.ts

# Frontend
cd frontend
bun install
bun run dev
```

## Environment Variables

```
OPENROUTER_API_KEY=your_key
LASTFM_API_KEY=your_key
SPOTIFY_CLIENT_ID=your_key  # for future use
```
