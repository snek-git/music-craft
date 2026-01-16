import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { db } from "../db";
import { userElements } from "../db/schema";

const JWT_SECRET = process.env.JWT_SECRET;

// Get userId from session cookie (returns null if not logged in)
export async function getUserIdFromSession(c: any): Promise<string | null> {
  if (!JWT_SECRET) return null;
  const sessionToken = getCookie(c, "session");
  if (!sessionToken) return null;
  try {
    const payload = await verify(sessionToken, JWT_SECRET, "HS256");
    return payload.userId as string;
  } catch {
    return null;
  }
}

// Add element to user's collection (idempotent)
export async function addToUserCollection(userId: string, elementId: string) {
  const existing = await db.query.userElements.findFirst({
    where: (ue, { and, eq }) => and(eq(ue.userId, userId), eq(ue.elementId, elementId)),
  });
  if (!existing) {
    await db.insert(userElements).values({
      id: crypto.randomUUID(),
      userId,
      elementId,
      discoveredAt: new Date(),
    });
  }
}

// Add multiple elements to user's collection
export async function addManyToUserCollection(userId: string, elementIds: string[]) {
  for (const elementId of elementIds) {
    await addToUserCollection(userId, elementId);
  }
}
