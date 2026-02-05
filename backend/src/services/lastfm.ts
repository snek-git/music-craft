const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

export interface LastFmArtist {
  name: string;
  url: string;
  listeners: number;
  playcount: number;
  bio?: string;
  tags?: string[];
}

// In-memory cache for Last.fm responses (1 hour TTL)
const cache = new Map<string, { data: LastFmArtist | null; expires: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(key: string): LastFmArtist | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(key: string, data: LastFmArtist | null) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  if (cache.size > 5000) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export async function getArtist(artistName: string): Promise<LastFmArtist | null> {
  const cacheKey = `artist:${artistName.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    method: "artist.getinfo",
    artist: artistName,
    api_key: process.env.LASTFM_API_KEY!,
    format: "json",
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  const data = await res.json() as {
    artist?: {
      name: string;
      url: string;
      stats: { listeners: string; playcount: string };
      bio?: { summary: string };
      tags?: { tag: Array<{ name: string }> };
    };
    error?: number;
  };

  if (data.error || !data.artist) {
    setCache(cacheKey, null);
    return null;
  }

  const result: LastFmArtist = {
    name: data.artist.name,
    url: data.artist.url,
    listeners: parseInt(data.artist.stats.listeners, 10),
    playcount: parseInt(data.artist.stats.playcount, 10),
    bio: data.artist.bio?.summary,
    tags: data.artist.tags?.tag.map((t) => t.name),
  };
  setCache(cacheKey, result);
  return result;
}

export async function searchArtist(query: string): Promise<LastFmArtist | null> {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    method: "artist.search",
    artist: query,
    api_key: process.env.LASTFM_API_KEY!,
    format: "json",
    limit: "1",
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  const data = await res.json() as {
    results?: {
      artistmatches?: {
        artist: Array<{ name: string; listeners: string; url: string }>;
      };
    };
  };

  const match = data.results?.artistmatches?.artist?.[0];
  if (!match) {
    setCache(cacheKey, null);
    return null;
  }

  // Get full info for the matched artist
  const result = await getArtist(match.name);
  setCache(cacheKey, result);
  return result;
}
