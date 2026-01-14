import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { elements, combinations } from "../db/schema";
import { combineElements as llmCombine } from "../services/llm";
import { getArtist } from "../services/lastfm";
import { findArtistIntersection, findArtistForGenre } from "../services/artistGraph";

const app = new Hono();

app.post("/", async (c) => {
  const { elementA: elementAId, elementB: elementBId } = await c.req.json<{
    elementA: string;
    elementB: string;
  }>();

  if (!elementAId || !elementBId) {
    return c.json({ error: "Both elementA and elementB are required" }, 400);
  }

  if (elementAId === elementBId) {
    return c.json({ error: "Cannot combine element with itself" }, 400);
  }

  const [elA, elB] = await Promise.all([
    db.query.elements.findFirst({ where: eq(elements.id, elementAId) }),
    db.query.elements.findFirst({ where: eq(elements.id, elementBId) }),
  ]);

  if (!elA || !elB) {
    return c.json({ error: "Element not found" }, 404);
  }

  const [sortedA, sortedB] = [elementAId, elementBId].sort();

  // Check cache first
  const existing = await db.query.combinations.findFirst({
    where: and(
      eq(combinations.elementA, sortedA),
      eq(combinations.elementB, sortedB)
    ),
  });

  if (existing) {
    const resultElement = await db.query.elements.findFirst({
      where: eq(elements.id, existing.result),
    });
    return c.json({
      combination: existing,
      result: resultElement,
      cached: true,
    });
  }

  // Get existing artists to exclude from results
  const existingArtists = await db
    .select({ name: elements.name })
    .from(elements)
    .where(eq(elements.type, "artist"));
  const excludeArtists = existingArtists.map((e) => e.name);

  let finalName = "";
  let finalType: "artist" | "genre" = "artist";
  let reasoning = "";
  let confidence = 0;
  let lastfmData = null;

  const isArtistA = elA.type === "artist";
  const isArtistB = elB.type === "artist";

  if (isArtistA && isArtistB) {
    // Artist + Artist = Graph intersection (BFS up to depth 3)
    console.log(`Finding intersection: ${elA.name} <-> ${elB.name}`);
    const intersection = await findArtistIntersection(
      elA.name,
      elB.name,
      3,
      excludeArtists
    );

    if (intersection) {
      finalName = intersection.artist;
      finalType = "artist";
      confidence = intersection.combinedScore;
      reasoning = `Found via listener overlap: ${intersection.pathA.join(" -> ")} meets ${intersection.pathB.reverse().join(" -> ")}`;
      console.log(`Intersection found: ${finalName} (score: ${confidence.toFixed(3)})`);

      // Get Last.fm data for the result
      const artistData = await getArtist(finalName);
      if (artistData) {
        lastfmData = { url: artistData.url, listeners: artistData.listeners };
      }
    } else {
      // Fall back to LLM if graph search fails
      console.log("No graph intersection found, falling back to LLM...");
      const [lastfmA, lastfmB] = await Promise.all([
        getArtist(elA.name),
        getArtist(elB.name),
      ]);
      const llmResult = await llmCombine(
        { name: elA.name, type: elA.type, bio: lastfmA?.bio, tags: lastfmA?.tags },
        { name: elB.name, type: elB.type, bio: lastfmB?.bio, tags: lastfmB?.tags }
      );
      if (llmResult) {
        finalName = llmResult.name;
        finalType = llmResult.type;
        confidence = llmResult.confidence;
        reasoning = `(LLM fallback) ${llmResult.reasoning}`;
      }
    }
  } else if (isArtistA || isArtistB) {
    // Artist + Genre = Find similar artist matching the genre vibe
    const artist = isArtistA ? elA.name : elB.name;
    const genre = isArtistA ? elB.name : elA.name;

    console.log(`Finding artist for: ${artist} + ${genre}`);
    const result = await findArtistForGenre(genre, artist, excludeArtists);

    if (result) {
      finalName = result.artist;
      finalType = "artist";
      confidence = result.combinedScore;
      reasoning = `Similar to ${artist}, in the direction of ${genre}`;

      const artistData = await getArtist(finalName);
      if (artistData) {
        lastfmData = { url: artistData.url, listeners: artistData.listeners };
      }
    }
  } else {
    // Genre + Genre = Use LLM (this is the only case where vibes make sense)
    console.log(`Genre fusion: ${elA.name} + ${elB.name}`);
    const llmResult = await llmCombine(
      { name: elA.name, type: elA.type },
      { name: elB.name, type: elB.type }
    );

    if (llmResult) {
      finalName = llmResult.name;
      finalType = llmResult.type;
      confidence = llmResult.confidence;
      reasoning = llmResult.reasoning;
    }
  }

  if (!finalName) {
    return c.json({ error: "No valid result found", noMatch: true }, 200);
  }

  // Check if element already exists
  let existingElement = await db.query.elements.findFirst({
    where: eq(elements.name, finalName),
  });

  let newElementId: string;
  const now = new Date();

  if (existingElement) {
    newElementId = existingElement.id;
  } else {
    newElementId = crypto.randomUUID();
    await db.insert(elements).values({
      id: newElementId,
      name: finalName,
      type: finalType,
      spotifySearchQuery: finalName,
      createdAt: now,
    });
  }

  const combinationId = crypto.randomUUID();
  await db.insert(combinations).values({
    id: combinationId,
    elementA: sortedA,
    elementB: sortedB,
    result: newElementId,
    confidence,
    reasoning,
    createdAt: now,
  });

  const newElement = await db.query.elements.findFirst({
    where: eq(elements.id, newElementId),
  });

  return c.json({
    combination: {
      id: combinationId,
      elementA: sortedA,
      elementB: sortedB,
      result: newElementId,
      confidence,
      reasoning,
    },
    result: newElement,
    lastfm: lastfmData,
    cached: false,
  });
});

export default app;
