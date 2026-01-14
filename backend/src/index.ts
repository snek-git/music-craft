import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { elements } from "./db/schema";
import combineRoutes from "./routes/combine";
import authRoutes from "./routes/auth";
import spotifyRoutes from "./routes/spotify";
import { getArtist, searchArtist } from "./services/lastfm";

const app = new Hono();

app.use("/*", cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

app.get("/api/elements", async (c) => {
  const allElements = await db.select().from(elements);
  return c.json(allElements);
});

app.get("/api/elements/lookup", async (c) => {
  const name = c.req.query("name");
  if (!name?.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  const validated = await getArtist(name) || await searchArtist(name);
  if (validated) {
    return c.json({ name: validated.name, listeners: validated.listeners });
  }
  return c.json({ name: null });
});

app.post("/api/elements", async (c) => {
  const { name, type } = await c.req.json<{ name: string; type: "genre" | "artist" }>();

  if (!name?.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  // Check if already exists
  const existing = await db.query.elements.findFirst({
    where: eq(elements.name, name.trim()),
  });
  if (existing) {
    return c.json(existing);
  }

  let finalName = name.trim();

  // Validate artist with Last.fm
  if (type === "artist") {
    const validated = await getArtist(name) || await searchArtist(name);
    if (validated) {
      finalName = validated.name;
    }
  }

  const id = crypto.randomUUID();
  await db.insert(elements).values({
    id,
    name: finalName,
    type: type || "artist",
    spotifySearchQuery: finalName,
    createdAt: new Date(),
  });

  const created = await db.query.elements.findFirst({ where: eq(elements.id, id) });
  return c.json(created);
});

app.route("/api/combine", combineRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/spotify", spotifyRoutes);

app.get("/api/artist/:name", async (c) => {
  const name = c.req.param("name");
  const info = await getArtist(name);
  if (!info) {
    return c.json({ error: "Artist not found" }, 404);
  }
  return c.json(info);
});

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 3001,
  fetch: app.fetch,
};

console.log("Backend running on http://localhost:3001");
