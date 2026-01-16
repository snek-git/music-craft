# CLAUDE.md

This file provides guidance for Claude Code when working on this project.

## Project Overview

**Music Craft** is an Infinite Craft-style music discovery app. Users drag genres and artists onto a canvas and combine them to discover new music at their intersection.

- **Genre + Genre** = new Genre
- **Genre + Artist** = new Artist
- **Artist + Artist** = new Artist

Inspired by [Infinite Craft](https://neal.fun/infinite-craft/) and [Every Noise at Once](https://everynoise.com/).

## Related Documentation

- @PROGRESS.md - Completed features and implementation details
- @ROADMAP.md - Planned features, priorities, and research notes on reducing LLM hallucination

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Svelte 5 + Vite |
| Backend | Bun + Hono |
| Database | Turso (libSQL) |
| ORM | Drizzle |
| AI | Claude Haiku via OpenRouter |
| Music APIs | Last.fm (validation/metadata), Spotify (OAuth/import/previews) |
| Deployment | Fly.io |
| Domain | Cloudflare DNS |

## Project Structure

```
music-craft/
├── frontend/                 # Svelte 5 frontend
│   ├── src/
│   │   ├── App.svelte       # Main component (single-file app)
│   │   └── main.ts          # Entry point
│   └── vite.config.ts       # Vite config with API proxy
├── backend/                  # Bun + Hono backend
│   ├── src/
│   │   ├── index.ts         # Server entry, API routes
│   │   ├── db/
│   │   │   ├── index.ts     # Drizzle + Turso connection
│   │   │   ├── schema.ts    # Database schema
│   │   │   └── seed.ts      # Seed script for tables + initial data
│   │   ├── routes/
│   │   │   ├── auth.ts      # Spotify OAuth flow
│   │   │   ├── combine.ts   # Element combination logic
│   │   │   └── spotify.ts   # Spotify import endpoints
│   │   └── services/
│   │       ├── lastfm.ts    # Last.fm API integration
│   │       ├── llm.ts       # OpenRouter/Claude for combinations
│   │       └── spotify.ts   # Spotify API integration
│   ├── drizzle.config.ts    # Drizzle kit config
│   └── .env                 # Environment variables (not committed)
├── Dockerfile               # Multi-stage Bun build
├── fly.toml                 # Fly.io deployment config
└── package.json             # Root workspace config
```

## Local Development

```bash
# Install dependencies
cd frontend && bun install
cd ../backend && bun install

# Set up environment variables
cp backend/.env.example backend/.env
# Fill in the values (see Environment Variables section)

# Seed the database (creates tables + initial genres/artists)
cd backend && bun run db:seed

# Run development servers
cd frontend && bun run dev    # http://localhost:5173
cd backend && bun run dev     # http://localhost:3001
```

The frontend Vite config proxies `/api` requests to the backend.

## Environment Variables

Create `backend/.env` with:

```bash
# Turso Database
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token

# OpenRouter (LLM for combinations)
OPENROUTER_API_KEY=sk-or-...

# Last.fm (artist validation and metadata)
LASTFM_API_KEY=your-key

# Spotify (OAuth and audio previews)
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=https://music-craft.snek.page/api/auth/callback

# App URLs (production)
FRONTEND_URL=https://music-craft.snek.page
CORS_ORIGIN=https://music-craft.snek.page

# JWT Secret for sessions
JWT_SECRET=your-random-secret
```

For local development, `SPOTIFY_REDIRECT_URI` should be `http://127.0.0.1:3001/api/auth/callback`.

## Database

Using **Turso** (libSQL) - a distributed SQLite-compatible database.

```bash
# Seed/create tables
cd backend && bun run db:seed

# Push schema changes
cd backend && bun run db:push
```

The connection falls back to `file:music-craft.db` for local development if Turso env vars aren't set.

### Schema

- **users**: Spotify OAuth data (tokens, profile info)
- **elements**: Genres and artists (name, type)
- **combinations**: Cached combination results (element_a + element_b = result)

## Deployment (Fly.io)

```bash
# Deploy
flyctl deploy

# Set secrets
flyctl secrets set \
  TURSO_DATABASE_URL="libsql://..." \
  TURSO_AUTH_TOKEN="..." \
  OPENROUTER_API_KEY="..." \
  LASTFM_API_KEY="..." \
  SPOTIFY_CLIENT_ID="..." \
  SPOTIFY_CLIENT_SECRET="..." \
  SPOTIFY_REDIRECT_URI="https://music-craft.snek.page/api/auth/callback" \
  FRONTEND_URL="https://music-craft.snek.page" \
  CORS_ORIGIN="https://music-craft.snek.page" \
  JWT_SECRET="..."

# View logs
flyctl logs -a music-craft

# SSH into machine
flyctl ssh console -a music-craft
```

### Custom Domain (Cloudflare)

1. `flyctl certs add music-craft.snek.page`
2. `flyctl ips allocate` (get IPv4 and IPv6)
3. Add A and AAAA records in Cloudflare DNS (proxy OFF)

## Key Features

### Click-to-Preview Audio
- Left-click any artist to play a 30-second Spotify preview
- Uses Spotify client credentials (no user login required)
- Minimal "now playing" indicator in bottom-right

### Spotify Import
- OAuth login to import user's top 50 artists + genres
- Batched database queries for fast import (2 queries instead of 100+)

### LLM Combinations
- Claude Haiku via OpenRouter for suggesting combinations
- Chain-of-thought prompting with 4-step reasoning for artists
- Last.fm context (bio, tags) enriched in prompts
- Retry logic with failed names as negative examples
- Validation against Last.fm before accepting artist suggestions

### Combination Caching
- Results cached by sorted element pair IDs
- "Rock + Jazz" and "Jazz + Rock" use the same cache

## Common Issues

### "no such table" errors
Run the seed script with Turso env vars:
```bash
export $(cat .env | xargs) && bun run db:seed
```

### Spotify OAuth redirect mismatch
Ensure `SPOTIFY_REDIRECT_URI` matches what's configured in the Spotify Developer Dashboard.

### CORS errors
Check that `CORS_ORIGIN` matches your frontend URL (including https).

## Development Notes

- Frontend uses relative API URLs (`/api/...`) - works in both dev (Vite proxy) and prod (same origin)
- Backend serves static files from `./public` in production
- The app is a single Svelte component (`App.svelte`) with no routing
- Drag-and-drop uses vanilla mouse events, not HTML5 Drag API
