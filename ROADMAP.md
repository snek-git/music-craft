# Roadmap

## High Priority

### Spotify Integration
- [x] OAuth login flow
- [x] Import user's top artists (+ their genres)
- [ ] Play artist previews in-app
- [ ] Create playlists from discovered artists

### Better Discovery
- [x] Exclude already-discovered artists from LLM suggestions
- [ ] Weighted randomness in suggestions (not always same artists)
- [ ] Multiple suggestion options to choose from
- [ ] "Surprise me" random combination

### Audio
- [ ] Spotify/YouTube preview playback
- [ ] Sample tracks in artist info popup

## Medium Priority

### UI Improvements
- [ ] Undo last combination
- [ ] Canvas zoom/pan for many elements
- [ ] Element grouping/clusters
- [ ] Search/filter in sidebar
- [ ] Keyboard shortcuts (delete, undo)
- [ ] Mobile touch support

### Data
- [ ] Export discoveries as playlist
- [ ] Share discoveries via link
- [x] User accounts to save progress (per-user collections)
- [ ] Discovery history/timeline

### Smarter Combinations
- [ ] Use Spotify audio features for better matching
- [ ] Consider artist popularity/obscurity preference
- [ ] Genre relationship graph for better genre combos
- [ ] Similar artist suggestions as alternatives

## Research: Reducing LLM Slop

### Problem
Pure LLM suggestions hallucinate artist names or suggest loosely-related artists. Example: suggesting Bauhaus for Killing Joke + The Cure - technically adjacent but not a true intersection.

### Current Approaches

**1. Last.fm Graph BFS** (implemented in `feature/lastfm-graph`)
- Bidirectional BFS on Last.fm's similar artists graph
- Finds artists with real listener overlap
- Works well for artists with connected fanbases (Radiohead + Bjork → PJ Harvey)
- Falls apart for disjoint artists (Aphex Twin + Kendrick → no graph intersection)

**2. LLM with Last.fm context** (current master)
- Feed artist bios, tags, listener counts to LLM
- Validate suggestions against Last.fm before accepting
- Retry with failed names as negative examples
- Still fundamentally vibes-based

### Proposed: Multi-Source Data + LLM Reasoning

Core insight: use LLM to *reason about real data*, not hallucinate from nothing.

**Data sources to combine:**
- [ ] Last.fm similar artists (listener behavior)
- [ ] Last.fm tags (crowd-sourced genre/mood labels)
- [ ] MusicBrainz relationships (influences, members, collaborations)
- [ ] Discogs credits (producers, labels, session musicians)
- [ ] Spotify audio features (tempo, energy, valence, acousticness)

**Architecture:**
1. Query all sources for both input artists
2. Find concrete intersections (shared tags, mutual influences, common collaborators)
3. Feed intersection data to LLM: "Given these shared tags [X, Y, Z] and these common influences [A, B], who sits at the true middle?"
4. LLM reasons over facts instead of guessing

**Why this reduces slop:**
- Every suggestion grounded in verifiable relationships
- LLM can't hallucinate connections that don't exist in the data
- Confidence correlates with data richness (more overlap = better suggestions)

### Open Questions
- Has anyone built this? (music recommendation via knowledge graph + LLM)
- Rate limiting across multiple APIs
- Cold start: what if an artist has sparse data everywhere?
- Embedding approach: train on all of music, find vector midpoint (expensive but theoretically optimal)

## Low Priority / Ideas

- [ ] Multiplayer - combine with friends
- [ ] Discovery challenges/achievements
- [ ] Artist "family tree" visualization
- [ ] Integration with other music services (Apple Music, Tidal)
- [ ] Local music library integration
- [ ] AI-generated playlists based on discovery path
- [ ] "Reverse discovery" - input an artist, find what genres made them
