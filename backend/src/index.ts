import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { eq, or, inArray } from "drizzle-orm";
import { db } from "./db";
import { elements, userElements } from "./db/schema";
import combineRoutes from "./routes/combine";
import authRoutes from "./routes/auth";
import spotifyRoutes from "./routes/spotify";
import { getArtist, searchArtist } from "./services/lastfm";
import { getArtistPreview } from "./services/spotify";
import { generalLimiter } from "./middleware/rateLimit";
import { getOrCreateUserId, addToUserCollection } from "./utils/userCollection";

const app = new Hono();

const isProduction = process.env.NODE_ENV === "production";

// Input validation constants
const MAX_NAME_LENGTH = 200;
const VALID_ELEMENT_TYPES = ["genre", "artist"] as const;

function validateName(name: string | undefined): { valid: false; error: string } | { valid: true; value: string } {
  if (!name?.trim()) {
    return { valid: false, error: "Name is required" };
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Name must be ${MAX_NAME_LENGTH} characters or less` };
  }
  return { valid: true, value: trimmed };
}

app.use("/*", cors({
  origin: isProduction
    ? [process.env.CORS_ORIGIN || "https://music-craft.fly.dev"]
    : ["http://127.0.0.1:5173", "http://localhost:5173"],
  credentials: true,
}));

// Apply general rate limiting to all API routes
app.use("/api/*", generalLimiter);

app.get("/api/elements", async (c) => {
  const userId = getOrCreateUserId(c);

  // Get user's discoveries
  const userDiscoveries = await db.select({ elementId: userElements.elementId })
    .from(userElements)
    .where(eq(userElements.userId, userId));

  const discoveredIds = userDiscoveries.map(d => d.elementId);

  let userElementsList;
  if (discoveredIds.length > 0) {
    userElementsList = await db.select().from(elements)
      .where(or(eq(elements.isBase, true), inArray(elements.id, discoveredIds)));
  } else {
    userElementsList = await db.select().from(elements).where(eq(elements.isBase, true));
  }

  return c.json(userElementsList);
});

app.get("/api/elements/lookup", async (c) => {
  const nameResult = validateName(c.req.query("name"));
  if (!nameResult.valid) {
    return c.json({ error: nameResult.error }, 400);
  }

  const validated = await getArtist(nameResult.value) || await searchArtist(nameResult.value);
  if (validated) {
    return c.json({ name: validated.name, listeners: validated.listeners });
  }
  return c.json({ name: null });
});

app.post("/api/elements", async (c) => {
  const userId = getOrCreateUserId(c);
  const { name, type } = await c.req.json<{ name: string; type: "genre" | "artist" }>();

  const nameResult = validateName(name);
  if (!nameResult.valid) {
    return c.json({ error: nameResult.error }, 400);
  }

  // Validate type
  const validType = VALID_ELEMENT_TYPES.includes(type as any) ? type : "artist";

  // Check if already exists globally
  const existing = await db.query.elements.findFirst({
    where: eq(elements.name, nameResult.value),
  });
  if (existing) {
    await addToUserCollection(userId, existing.id);
    return c.json(existing);
  }

  let finalName = nameResult.value;

  // Validate artist with Last.fm
  if (validType === "artist") {
    const validated = await getArtist(nameResult.value) || await searchArtist(nameResult.value);
    if (validated) {
      finalName = validated.name;
    }
  }

  const id = crypto.randomUUID();
  await db.insert(elements).values({
    id,
    name: finalName,
    type: validType,
    spotifySearchQuery: finalName,
    isBase: false,
    createdAt: new Date(),
  });

  await addToUserCollection(userId, id);

  const created = await db.query.elements.findFirst({ where: eq(elements.id, id) });
  return c.json(created);
});

app.route("/api/combine", combineRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/spotify", spotifyRoutes);

app.get("/api/artist/:name", async (c) => {
  const nameResult = validateName(c.req.param("name"));
  if (!nameResult.valid) {
    return c.json({ error: nameResult.error }, 400);
  }
  const info = await getArtist(nameResult.value);
  if (!info) {
    return c.json({ error: "Artist not found" }, 404);
  }
  return c.json(info);
});

app.get("/api/preview/:name", async (c) => {
  const nameResult = validateName(c.req.param("name"));
  if (!nameResult.valid) {
    return c.json({ error: nameResult.error }, 400);
  }
  const preview = await getArtistPreview(nameResult.value);
  if (!preview) {
    return c.json({ error: "No preview available" }, 404);
  }
  return c.json(preview);
});

app.get("/health", (c) => c.json({ status: "ok" }));

// Serve static files in production
if (isProduction) {
  app.use("/*", serveStatic({ root: "./public" }));

  // SPA fallback - serve index.html for all non-API routes
  app.get("*", serveStatic({ path: "./public/index.html" }));
}

export default {
  port: 3001,
  fetch: app.fetch,
};

console.log(`Backend running on http://localhost:3001 (${isProduction ? "production" : "development"})`);
