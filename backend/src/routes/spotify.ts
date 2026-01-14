import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { db } from "../db";
import { users, elements } from "../db/schema";
import { getTopArtists, refreshAccessToken } from "../services/spotify";

const app = new Hono();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

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
app.get("/top-artists", async (c) => {
  const user = c.get("user");
  const timeRange = c.req.query("time_range") as "short_term" | "medium_term" | "long_term" || "medium_term";
  const limit = parseInt(c.req.query("limit") || "50");

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
app.post("/import", async (c) => {
  const { artistIds } = await c.req.json<{ artistIds: string[] }>();

  if (!artistIds || !Array.isArray(artistIds)) {
    return c.json({ error: "artistIds array is required" }, 400);
  }

  const user = c.get("user");

  try {
    // Get top artists to find the ones to import
    const topArtists = await getTopArtists(user.accessToken, "medium_term", 50);
    const artistsToImport = topArtists.filter((a) => artistIds.includes(a.id));

    const importedArtists: string[] = [];
    const skippedArtists: string[] = [];
    const importedGenres: string[] = [];
    const skippedGenres: string[] = [];

    // Collect all unique genres from selected artists
    const allGenres = new Set<string>();
    for (const artist of artistsToImport) {
      for (const genre of artist.genres) {
        // Capitalize first letter of each word
        const formattedGenre = genre
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        allGenres.add(formattedGenre);
      }
    }

    // Import genres
    for (const genre of allGenres) {
      const existing = await db.query.elements.findFirst({
        where: eq(elements.name, genre),
      });

      if (existing) {
        skippedGenres.push(genre);
        continue;
      }

      const id = crypto.randomUUID();
      await db.insert(elements).values({
        id,
        name: genre,
        type: "genre",
        createdAt: new Date(),
      });
      importedGenres.push(genre);
    }

    // Import artists
    for (const artist of artistsToImport) {
      const existing = await db.query.elements.findFirst({
        where: eq(elements.name, artist.name),
      });

      if (existing) {
        skippedArtists.push(artist.name);
        continue;
      }

      const id = crypto.randomUUID();
      await db.insert(elements).values({
        id,
        name: artist.name,
        type: "artist",
        spotifySearchQuery: artist.name,
        createdAt: new Date(),
      });
      importedArtists.push(artist.name);
    }

    return c.json({
      success: true,
      artists: { imported: importedArtists, skipped: skippedArtists },
      genres: { imported: importedGenres, skipped: skippedGenres },
      total: importedArtists.length + importedGenres.length,
    });
  } catch (error) {
    console.error("Failed to import:", error);
    return c.json({ error: "Failed to import" }, 500);
  }
});

export default app;
