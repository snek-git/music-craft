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
- [x] 25 seed genres

### LLM Integration
- [x] OpenRouter API with Claude Haiku 4.5
- [x] Chain-of-thought prompting for better intersection finding
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
- [x] Discovery notification in sidebar
- [x] "No match" feedback with red styling
- [x] Manual artist entry with confirmation flow
- [x] Duplicate prevention (check by name)
