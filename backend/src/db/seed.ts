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
  "Pop", "R&B", "Metal", "Country", "Folk"
];

const SEED_ARTISTS = [
  // Rock
  "The Beatles", "Pink Floyd", "Radiohead",
  // Electronic
  "Daft Punk", "Aphex Twin", "Björk",
  // Hip-Hop
  "Kanye West", "Kendrick Lamar",
  // Jazz
  "Miles Davis", "John Coltrane",
  // Pop
  "Michael Jackson", "David Bowie", "Prince",
  // R&B
  "Stevie Wonder", "Frank Ocean",
  // Metal
  "Black Sabbath", "Metallica",
  // Country
  "Johnny Cash", "Dolly Parton",
  // Folk
  "Bob Dylan", "Joni Mitchell",
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
      is_base INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_elements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      element_id TEXT NOT NULL REFERENCES elements(id),
      discovered_at INTEGER NOT NULL,
      UNIQUE(user_id, element_id)
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_user_elements_user ON user_elements(user_id)
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
      isBase: true,
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
      isBase: true,
      createdAt: now,
    }).onConflictDoNothing();
  }

  console.log(`Seeded ${SEED_GENRES.length} genres and ${SEED_ARTISTS.length} artists`);
}

seed().catch(console.error);
