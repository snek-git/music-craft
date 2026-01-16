import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { elements } from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:music-craft.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client);

const SEED_GENRES = [
  "Rock", "Electronic", "Hip-Hop", "Jazz", "Classical",
  "Ambient", "Metal", "Folk", "R&B", "Punk",
  "Country", "Blues", "Soul", "Reggae", "Indie"
];

const SEED_ARTISTS = [
  "Radiohead", "Kendrick Lamar", "Björk", "Aphex Twin", "Daft Punk",
  "Tame Impala", "Frank Ocean", "Bon Iver", "Flying Lotus", "Portishead",
  "LCD Soundsystem", "Beach House", "Massive Attack", "Boards of Canada", "Burial",
  "King Krule", "Tyler, The Creator", "FKA Twigs", "James Blake", "Grimes",
  "Mac DeMarco", "Car Seat Headrest", "Thundercat", "Anderson .Paak", "Daniel Caesar"
];

async function seed() {
  console.log("Creating tables...");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      spotify_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS elements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('genre', 'artist')),
      spotify_search_query TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS combinations (
      id TEXT PRIMARY KEY,
      element_a TEXT NOT NULL REFERENCES elements(id),
      element_b TEXT NOT NULL REFERENCES elements(id),
      result TEXT NOT NULL REFERENCES elements(id),
      confidence REAL NOT NULL,
      reasoning TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_combo_elements ON combinations(element_a, element_b)
  `);

  const now = new Date();

  console.log("Seeding genres...");
  for (const genre of SEED_GENRES) {
    const id = crypto.randomUUID();
    await db.insert(elements).values({
      id,
      name: genre,
      type: "genre",
      spotifySearchQuery: `genre:${genre.toLowerCase()}`,
      createdAt: now,
    }).onConflictDoNothing();
  }

  console.log("Seeding artists...");
  for (const artist of SEED_ARTISTS) {
    const id = crypto.randomUUID();
    await db.insert(elements).values({
      id,
      name: artist,
      type: "artist",
      spotifySearchQuery: artist,
      createdAt: now,
    }).onConflictDoNothing();
  }

  console.log(`Seeded ${SEED_GENRES.length} genres and ${SEED_ARTISTS.length} artists`);
}

seed().catch(console.error);
