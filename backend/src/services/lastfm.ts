const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

export interface LastFmArtist {
  name: string;
  url: string;
  listeners: number;
  playcount: number;
  bio?: string;
  tags?: string[];
}

export async function getArtist(artistName: string): Promise<LastFmArtist | null> {
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
    return null;
  }

  return {
    name: data.artist.name,
    url: data.artist.url,
    listeners: parseInt(data.artist.stats.listeners, 10),
    playcount: parseInt(data.artist.stats.playcount, 10),
    bio: data.artist.bio?.summary,
    tags: data.artist.tags?.tag.map((t) => t.name),
  };
}

export interface SimilarArtist {
  name: string;
  match: number; // 0-1 similarity score
}

export async function getSimilarArtists(artistName: string, limit = 50): Promise<SimilarArtist[]> {
  const params = new URLSearchParams({
    method: "artist.getsimilar",
    artist: artistName,
    api_key: process.env.LASTFM_API_KEY!,
    format: "json",
    limit: limit.toString(),
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const text = await res.text();

    let data: {
      similarartists?: {
        artist: Array<{ name: string; match: string }>;
      };
      error?: number;
    };

    try {
      data = JSON.parse(text);
    } catch {
      console.error(`Failed to parse Last.fm response for ${artistName}:`, text.slice(0, 100));
      return [];
    }

    if (data.error || !data.similarartists?.artist) {
      return [];
    }

    return data.similarartists.artist.map((a) => ({
      name: a.name,
      match: parseFloat(a.match),
    }));
  } catch (e) {
    console.error(`Failed to fetch similar artists for ${artistName}:`, e);
    return [];
  }
}

export async function searchArtist(query: string): Promise<LastFmArtist | null> {
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
  if (!match) return null;

  // Get full info for the matched artist
  return getArtist(match.name);
}
