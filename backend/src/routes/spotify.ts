import { Hono } from "hono";
import { db } from "../db";
import { elements } from "../db/schema";
import { getTopArtists } from "../services/spotify";
import { spotifyLimiter } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";
import { getOrCreateUserId, addManyToUserCollection } from "../utils/userCollection";

const app = new Hono();

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

  const spotifyUser = c.get("user"); // Spotify user for API access
  const localUserId = getOrCreateUserId(c); // Local user for collection

  try {
    // Get top artists to find the ones to import
    const topArtists = await getTopArtists(spotifyUser.accessToken, "medium_term", 50);
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
    const existingElements = await db.select({ id: elements.id, name: elements.name }).from(elements);
    const existingByName = new Map(existingElements.map((e) => [e.name, e.id]));

    // Filter out existing ones for creation
    const newGenres = [...allGenres].filter((g) => !existingByName.has(g));
    const newArtists = artistsToImport.filter((a) => !existingByName.has(a.name));

    // Batch insert all new genres and artists
    const now = new Date();
    const newElements = [
      ...newGenres.map((genre) => ({
        id: crypto.randomUUID(),
        name: genre,
        type: "genre" as const,
        isBase: false,
        createdAt: now,
      })),
      ...newArtists.map((artist) => ({
        id: crypto.randomUUID(),
        name: artist.name,
        type: "artist" as const,
        spotifySearchQuery: artist.name,
        isBase: false,
        createdAt: now,
      })),
    ];

    if (newElements.length > 0) {
      await db.insert(elements).values(newElements);
    }

    // Collect all element IDs to add to user's collection (new + existing)
    const allElementIds: string[] = [];

    // Add new element IDs
    for (const el of newElements) {
      allElementIds.push(el.id);
    }

    // Add existing element IDs for genres and artists being imported
    for (const genre of allGenres) {
      const existingId = existingByName.get(genre);
      if (existingId) allElementIds.push(existingId);
    }
    for (const artist of artistsToImport) {
      const existingId = existingByName.get(artist.name);
      if (existingId) allElementIds.push(existingId);
    }

    // Add all to user's local collection
    if (allElementIds.length > 0) {
      await addManyToUserCollection(localUserId, allElementIds);
    }

    return c.json({
      success: true,
      artists: {
        imported: newArtists.map((a) => a.name),
        skipped: artistsToImport.filter((a) => existingByName.has(a.name)).map((a) => a.name),
      },
      genres: {
        imported: newGenres,
        skipped: [...allGenres].filter((g) => existingByName.has(g)),
      },
      total: newElements.length,
    });
  } catch (error) {
    console.error("Failed to import:", error);
    return c.json({ error: "Failed to import" }, 500);
  }
});

export default app;
