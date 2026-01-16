import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { db } from "../db";
import { users, elements } from "../db/schema";
import { getTopArtists, refreshAccessToken } from "../services/spotify";
import { spotifyLimiter } from "../middleware/rateLimit";

const app = new Hono();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// Middleware to require authentication
async function requireAuth(c: any, next: () => Promise<void>) {
  // Check Authorization header first, then fall back to cookie
  let sessionToken = null;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    sessionToken = authHeader.slice(7);
  } else {
    sessionToken = getCookie(c, "session");
  }

  if (!sessionToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verify(sessionToken, JWT_SECRET, "HS256");
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId as string),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    // Check if token needs refresh
    const now = new Date();
    if (user.tokenExpiresAt <= now) {
      try {
        const tokens = await refreshAccessToken(user.refreshToken);
        const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);

        await db
          .update(users)
          .set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));

        user.accessToken = tokens.access_token;
        user.refreshToken = tokens.refresh_token;
        user.tokenExpiresAt = expiresAt;
      } catch (error) {
        console.error("Token refresh failed:", error);
        return c.json({ error: "Token refresh failed" }, 401);
      }
    }

    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "Invalid session" }, 401);
  }
}

app.use("*", requireAuth);

// GET /api/spotify/top-artists - Get user's top artists
app.get("/top-artists", spotifyLimiter, async (c) => {
  const user = c.get("user");

  // Validate time_range parameter
  const timeRangeParam = c.req.query("time_range");
  const validTimeRanges = ["short_term", "medium_term", "long_term"] as const;
  const timeRange = validTimeRanges.includes(timeRangeParam as any)
    ? (timeRangeParam as "short_term" | "medium_term" | "long_term")
    : "medium_term";

  // Validate and clamp limit parameter (max 50, min 1)
  const rawLimit = parseInt(c.req.query("limit") || "50");
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 50);

  try {
    const topArtists = await getTopArtists(user.accessToken, timeRange, limit);

    return c.json({
      artists: topArtists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        imageUrl: artist.images?.[0]?.url,
        popularity: artist.popularity,
        spotifyUrl: artist.external_urls.spotify,
      })),
    });
  } catch (error) {
    console.error("Failed to get top artists:", error);
    return c.json({ error: "Failed to fetch top artists" }, 500);
  }
});

// POST /api/spotify/import - Import selected artists and their genres
app.post("/import", spotifyLimiter, async (c) => {
  const { artistIds } = await c.req.json<{ artistIds: string[] }>();

  if (!artistIds || !Array.isArray(artistIds)) {
    return c.json({ error: "artistIds array is required" }, 400);
  }

  // Validate artistIds - max 50, must be strings, max 100 chars each
  if (artistIds.length > 50) {
    return c.json({ error: "Maximum 50 artists can be imported at once" }, 400);
  }
  const validIds = artistIds.filter(
    (id) => typeof id === "string" && id.length > 0 && id.length <= 100
  );
  if (validIds.length !== artistIds.length) {
    return c.json({ error: "Invalid artist IDs provided" }, 400);
  }

  const user = c.get("user");

  try {
    // Get top artists to find the ones to import
    const topArtists = await getTopArtists(user.accessToken, "medium_term", 50);
    const artistsToImport = topArtists.filter((a) => artistIds.includes(a.id));

    // Collect all unique genres from selected artists
    const allGenres = new Set<string>();
    for (const artist of artistsToImport) {
      for (const genre of artist.genres) {
        const formattedGenre = genre
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        allGenres.add(formattedGenre);
      }
    }

    // Get all existing elements in ONE query
    const existingElements = await db.select({ name: elements.name }).from(elements);
    const existingNames = new Set(existingElements.map((e) => e.name));

    // Filter out existing ones
    const newGenres = [...allGenres].filter((g) => !existingNames.has(g));
    const newArtists = artistsToImport.filter((a) => !existingNames.has(a.name));

    // Batch insert all new genres and artists
    const now = new Date();
    const newElements = [
      ...newGenres.map((genre) => ({
        id: crypto.randomUUID(),
        name: genre,
        type: "genre" as const,
        createdAt: now,
      })),
      ...newArtists.map((artist) => ({
        id: crypto.randomUUID(),
        name: artist.name,
        type: "artist" as const,
        spotifySearchQuery: artist.name,
        createdAt: now,
      })),
    ];

    if (newElements.length > 0) {
      await db.insert(elements).values(newElements);
    }

    return c.json({
      success: true,
      artists: {
        imported: newArtists.map((a) => a.name),
        skipped: artistsToImport.filter((a) => existingNames.has(a.name)).map((a) => a.name),
      },
      genres: {
        imported: newGenres,
        skipped: [...allGenres].filter((g) => existingNames.has(g)),
      },
      total: newElements.length,
    });
  } catch (error) {
    console.error("Failed to import:", error);
    return c.json({ error: "Failed to import" }, 500);
  }
});

export default app;
