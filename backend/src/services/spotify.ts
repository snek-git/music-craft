const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:5173/auth/callback";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

// Client credentials token cache
let clientToken: string | null = null;
let clientTokenExpiry: number = 0;

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface SpotifyUser {
  id: string;
  display_name: string;
  email?: string;
  images?: Array<{ url: string }>;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  images?: Array<{ url: string }>;
  popularity: number;
  external_urls: {
    spotify: string;
  };
}

export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    scope: "user-top-read user-read-email",
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token refresh failed: ${error}`);
  }

  const data = await response.json();
  // Refresh token endpoint doesn't always return a new refresh token
  if (!data.refresh_token) {
    data.refresh_token = refreshToken;
  }

  return data;
}

export async function getCurrentUser(accessToken: string): Promise<SpotifyUser> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Spotify user: ${error}`);
  }

  return response.json();
}

export async function getTopArtists(
  accessToken: string,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
  limit: number = 50
): Promise<SpotifyArtist[]> {
  const params = new URLSearchParams({
    time_range: timeRange,
    limit: limit.toString(),
  });

  const response = await fetch(`${SPOTIFY_API_BASE}/me/top/artists?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get top artists: ${error}`);
  }

  const data = await response.json();
  return data.items;
}

export async function searchArtist(accessToken: string, query: string): Promise<SpotifyArtist | null> {
  const params = new URLSearchParams({
    q: query,
    type: "artist",
    limit: "1",
  });

  const response = await fetch(`${SPOTIFY_API_BASE}/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.artists.items[0] || null;
}

// Get client credentials token (no user auth needed)
async function getClientToken(): Promise<string> {
  if (clientToken && Date.now() < clientTokenExpiry) {
    return clientToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error("Failed to get client credentials token");
  }

  const data = await response.json();
  clientToken = data.access_token;
  clientTokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 1 min early
  return clientToken;
}

export interface ArtistPreview {
  artistName: string;
  trackName: string;
  previewUrl: string;
  albumArt?: string;
}

// Get preview URL for an artist's top track (no user auth needed)
export async function getArtistPreview(artistName: string): Promise<ArtistPreview | null> {
  const token = await getClientToken();

  // Search for artist
  const searchParams = new URLSearchParams({
    q: artistName,
    type: "artist",
    limit: "1",
  });

  const searchRes = await fetch(`${SPOTIFY_API_BASE}/search?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchRes.ok) return null;

  const searchData = await searchRes.json();
  const artist = searchData.artists?.items?.[0];
  if (!artist) return null;

  // Get top tracks
  const topTracksRes = await fetch(`${SPOTIFY_API_BASE}/artists/${artist.id}/top-tracks?market=US`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!topTracksRes.ok) return null;

  const topTracksData = await topTracksRes.json();

  // Find first track with a preview URL
  const trackWithPreview = topTracksData.tracks?.find((t: any) => t.preview_url);
  if (!trackWithPreview) return null;

  return {
    artistName: artist.name,
    trackName: trackWithPreview.name,
    previewUrl: trackWithPreview.preview_url,
    albumArt: trackWithPreview.album?.images?.[1]?.url || trackWithPreview.album?.images?.[0]?.url,
  };
}
