import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { elements, combinations } from "../db/schema";
import { combineElements } from "../services/llm";
import { getArtist, searchArtist } from "../services/lastfm";
import { combineLimiter } from "../middleware/rateLimit";
import { getOrCreateUserId, addToUserCollection } from "../utils/userCollection";

const app = new Hono();

const MAX_RETRIES = 3;

// Stricter rate limit for combine endpoint (LLM calls are expensive)
app.post("/", combineLimiter, async (c) => {
  const userId = getOrCreateUserId(c);
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
    // Add to user's collection even if cached
    if (resultElement) {
      await addToUserCollection(userId, resultElement.id);
    }
    return c.json({
      combination: existing,
      result: resultElement,
      cached: true,
    });
  }

  const failedNames: string[] = [];
  let llmResult = null;
  let finalName = "";
  let lastfmData = null;
  let lastSuggestion = "";

  // Get all existing artists to avoid repetition
  const existingArtists = await db.select({ name: elements.name })
    .from(elements)
    .where(eq(elements.type, "artist"));
  const excludeArtists = existingArtists.map(e => e.name);

  // Fetch Last.fm data for artists to enrich the LLM prompt
  const [lastfmA, lastfmB] = await Promise.all([
    elA.type === "artist" ? getArtist(elA.name) : null,
    elB.type === "artist" ? getArtist(elB.name) : null,
  ]);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    llmResult = await combineElements(
      { name: elA.name, type: elA.type, bio: lastfmA?.bio, tags: lastfmA?.tags },
      { name: elB.name, type: elB.type, bio: lastfmB?.bio, tags: lastfmB?.tags },
      failedNames
    );

    if (!llmResult) break;

    // For artists, try to validate with Last.fm
    if (llmResult.type === "artist") {
      lastSuggestion = llmResult.name;
      let validated = await getArtist(llmResult.name);
      if (!validated) {
        validated = await searchArtist(llmResult.name);
      }

      if (validated) {
        console.log(`Validated artist: ${validated.name} (${validated.listeners} listeners)`);
        finalName = validated.name;
        lastfmData = { url: validated.url, listeners: validated.listeners };
        break;
      }

      console.log(`Artist not found on Last.fm: ${llmResult.name}, retrying...`);
      failedNames.push(llmResult.name);
    } else {
      // Genres don't need validation
      finalName = llmResult.name;
      break;
    }
  }

  // If Last.fm validation failed but LLM suggested something, accept it anyway
  if (!finalName && lastSuggestion && llmResult) {
    console.log(`Accepting unverified artist: ${lastSuggestion}`);
    finalName = lastSuggestion;
  }

  if (!llmResult || !finalName) {
    return c.json({ error: "No valid result found", noMatch: true }, 200);
  }

  // Check if element with same name already exists
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
      type: llmResult.type,
      spotifySearchQuery: finalName,
      isBase: false,
      createdAt: now,
    });
  }

  // Add result to user's collection
  await addToUserCollection(userId, newElementId);

  const combinationId = crypto.randomUUID();
  await db.insert(combinations).values({
    id: combinationId,
    elementA: sortedA,
    elementB: sortedB,
    result: newElementId,
    confidence: llmResult.confidence,
    reasoning: llmResult.reasoning,
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
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,
      summary: llmResult.summary,
    },
    result: newElement,
    lastfm: lastfmData,
    cached: false,
  });
});

export default app;
