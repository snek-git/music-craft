import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { elements, combinations } from "../db/schema";
import { combineElements } from "../services/llm";
import { getArtist, searchArtist } from "../services/lastfm";
import { combineLimiter } from "../middleware/rateLimit";
import { getOrCreateUserId, addToUserCollection } from "../utils/userCollection";

const app = new Hono();

interface ValidatedOption {
  name: string;
  reasoning: string;
  summary: string;
  confidence: number;
  lastfm?: { url: string; listeners: number };
}

// Helper to save a combination result to the database
async function saveCombination(
  userId: string,
  sortedA: string,
  sortedB: string,
  selected: { name: string; type: "genre" | "artist"; reasoning: string; summary: string; confidence: number; lastfm?: { url: string; listeners: number } }
) {
  let existingElement = await db.query.elements.findFirst({
    where: eq(elements.name, selected.name),
  });

  let newElementId: string;
  const now = new Date();

  if (existingElement) {
    newElementId = existingElement.id;
  } else {
    newElementId = crypto.randomUUID();
    await db.insert(elements).values({
      id: newElementId,
      name: selected.name,
      type: selected.type,
      spotifySearchQuery: selected.name,
      isBase: false,
      createdAt: now,
    });
  }

  await addToUserCollection(userId, newElementId);

  const combinationId = crypto.randomUUID();
  await db.insert(combinations).values({
    id: combinationId,
    elementA: sortedA,
    elementB: sortedB,
    result: newElementId,
    confidence: selected.confidence,
    reasoning: selected.reasoning,
    summary: selected.summary,
    createdAt: now,
  });

  const newElement = await db.query.elements.findFirst({
    where: eq(elements.id, newElementId),
  });

  return {
    combination: {
      id: combinationId,
      elementA: sortedA,
      elementB: sortedB,
      result: newElementId,
      confidence: selected.confidence,
      reasoning: selected.reasoning,
      summary: selected.summary,
    },
    result: newElement,
    lastfm: selected.lastfm,
    cached: false,
  };
}

// Stricter rate limit for combine endpoint (LLM calls are expensive)
app.post("/", combineLimiter, async (c) => {
  const userId = getOrCreateUserId(c);
  const { elementA: elementAId, elementB: elementBId, autoSelect = true } = await c.req.json<{
    elementA: string;
    elementB: string;
    autoSelect?: boolean;
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

  // Fetch Last.fm data for artists to enrich the LLM prompt
  const [lastfmA, lastfmB] = await Promise.all([
    elA.type === "artist" ? getArtist(elA.name) : null,
    elB.type === "artist" ? getArtist(elB.name) : null,
  ]);

  const llmResult = await combineElements(
    { name: elA.name, type: elA.type, bio: lastfmA?.bio, tags: lastfmA?.tags },
    { name: elB.name, type: elB.type, bio: lastfmB?.bio, tags: lastfmB?.tags },
    []
  );

  if (!llmResult || llmResult.candidates.length === 0) {
    return c.json({ error: "No valid result found", noMatch: true }, 200);
  }

  const outputType = llmResult.type;

  // For genres, don't need validation
  if (outputType === "genre") {
    const options = llmResult.candidates.map(c => ({
      name: c.name,
      reasoning: c.reasoning,
      summary: c.summary,
      confidence: c.confidence,
    }));

    if (autoSelect) {
      const top = options[0];
      const saved = await saveCombination(userId, sortedA, sortedB, { ...top, type: "genre" });
      return c.json({ ...saved, alternates: options.slice(1) });
    }

    return c.json({ options, type: outputType, elementA: sortedA, elementB: sortedB });
  }

  // For artists, validate candidates against Last.fm
  // Use Promise.allSettled with early collection - validate in parallel but don't block on slow ones
  const validatedOptions: ValidatedOption[] = [];
  const validationPromises = llmResult.candidates.map(async (candidate) => {
    let validated = await getArtist(candidate.name);
    if (!validated) {
      validated = await searchArtist(candidate.name);
    }
    if (validated) {
      const option: ValidatedOption = {
        name: validated.name,
        reasoning: candidate.reasoning,
        summary: candidate.summary,
        confidence: candidate.confidence,
        lastfm: { url: validated.url, listeners: validated.listeners },
      };
      validatedOptions.push(option);
      return option;
    }
    return null;
  });

  await Promise.all(validationPromises);

  if (validatedOptions.length === 0) {
    const topCandidate = llmResult.candidates[0];
    const fallback = {
      name: topCandidate.name,
      reasoning: topCandidate.reasoning,
      summary: topCandidate.summary,
      confidence: topCandidate.confidence,
    };

    if (autoSelect) {
      const saved = await saveCombination(userId, sortedA, sortedB, { ...fallback, type: "artist" });
      return c.json(saved);
    }

    return c.json({ options: [fallback], type: outputType, elementA: sortedA, elementB: sortedB });
  }

  // Sort by confidence to ensure best result first
  validatedOptions.sort((a, b) => b.confidence - a.confidence);

  if (autoSelect) {
    const top = validatedOptions[0];
    const saved = await saveCombination(userId, sortedA, sortedB, { ...top, type: "artist" });
    return c.json({ ...saved, alternates: validatedOptions.slice(1) });
  }

  return c.json({ options: validatedOptions, type: outputType, elementA: sortedA, elementB: sortedB });
});

// Endpoint to confirm a selection and save the combination
app.post("/select", combineLimiter, async (c) => {
  const userId = getOrCreateUserId(c);
  const { elementA: elementAId, elementB: elementBId, selected } = await c.req.json<{
    elementA: string;
    elementB: string;
    selected: {
      name: string;
      reasoning: string;
      summary: string;
      confidence: number;
      type: "genre" | "artist";
      lastfm?: { url: string; listeners: number };
    };
  }>();

  if (!elementAId || !elementBId || !selected) {
    return c.json({ error: "elementA, elementB, and selected are required" }, 400);
  }

  if (typeof selected.name !== "string" || selected.name.length < 1 || selected.name.length > 200) {
    return c.json({ error: "selected.name must be a string between 1 and 200 characters" }, 400);
  }

  if (selected.type !== "genre" && selected.type !== "artist") {
    return c.json({ error: "selected.type must be 'genre' or 'artist'" }, 400);
  }

  if (typeof selected.confidence !== "number" || selected.confidence < 0 || selected.confidence > 1) {
    return c.json({ error: "selected.confidence must be a number between 0 and 1" }, 400);
  }

  const [sortedA, sortedB] = [elementAId, elementBId].sort();

  // Check if already cached (race condition protection)
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
    if (resultElement) {
      await addToUserCollection(userId, resultElement.id);
    }
    return c.json({
      combination: existing,
      result: resultElement,
      cached: true,
    });
  }

  const saved = await saveCombination(userId, sortedA, sortedB, selected);
  return c.json(saved);
});

export default app;
