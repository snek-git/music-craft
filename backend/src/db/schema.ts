import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  spotifyId: text("spotify_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const elements = sqliteTable("elements", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["genre", "artist"] }).notNull(),
  spotifySearchQuery: text("spotify_search_query"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const combinations = sqliteTable("combinations", {
  id: text("id").primaryKey(),
  elementA: text("element_a").notNull().references(() => elements.id),
  elementB: text("element_b").notNull().references(() => elements.id),
  result: text("result").notNull().references(() => elements.id),
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Element = typeof elements.$inferSelect;
export type Combination = typeof combinations.$inferSelect;
