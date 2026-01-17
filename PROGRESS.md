# Progress

## Completed

### Core Features
- [x] Infinite Craft-style drag & drop UI
- [x] Custom mouse-based dragging (not HTML5 drag API)
- [x] Proximity-based element combining
- [x] Element type logic: genre+genre=genre, otherwise artist
- [x] Sidebar with genres/artists categories
- [x] Drag elements back to sidebar to remove from canvas

### Backend
- [x] Bun + Hono server
- [x] SQLite database with Drizzle ORM
- [x] Elements and combinations tables
- [x] Combination caching (don't re-query same pairs)
- [x] Curated seed data (10 genres + 24 artists)

### Per-User Collections
- [x] user_elements junction table for tracking discoveries
- [x] Local user ID via cookie-based UUID (no login required)
- [x] All users see seeds + their discoveries
- [x] Combinations cached globally, results added to user's collection
- [x] Spotify imports added to user's collection

### Security
- [x] Rate limiting (general, combine, auth, spotify endpoints)
- [x] httpOnly cookie sessions (not localStorage)
- [x] JWT_SECRET required (no insecure fallback)
- [x] Input validation (length limits, type validation, parameter bounds)

### LLM Integration
- [x] OpenRouter API with Claude Haiku 4.5
- [x] Chain-of-thought prompting with 5-candidate brainstorming
- [x] Reconsideration step for each candidate
- [x] Summary field (~10 words) for discovery speech bubble
- [x] Retry logic when suggested artist not found
- [x] Accept unverified artists after retries exhausted
- [x] Include Last.fm bio/tags in prompt for context

### Last.fm Integration
- [x] Artist validation via Last.fm API
- [x] Artist search fallback
- [x] Artist info popup on click (bio, tags, listeners)
- [x] Link to Last.fm page

### UI/UX
- [x] Dark theme with amber (genres) and pink (artists) accents
- [x] Dotted canvas background
- [x] Loading spinner at combination position
- [x] Discovery speech bubble (positioned at new element)
- [x] "No match" feedback with red styling
- [x] Manual artist entry with confirmation flow
- [x] Duplicate prevention (check by name)
- [x] One-time help tooltip after first combination

### Mobile Support
- [x] Hamburger menu for sidebar toggle
- [x] Touch event handlers (drag, tap, long press)
- [x] Long press for artist info, tap for audio preview
- [x] Responsive layout with media queries

### Audio Previews
- [x] Deezer API for 30-second track previews (no auth needed)
- [x] Click any artist to play their top track
- [x] "Now playing" indicator with track info
- [x] Right-click doesn't interrupt playback
