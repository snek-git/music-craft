import { getCookie, setCookie } from "hono/cookie";
import { db } from "../db";
import { userElements } from "../db/schema";

// Get or create a local user ID from cookie
export function getOrCreateUserId(c: any): string {
  let userId = getCookie(c, "user_id");
  if (!userId) {
    userId = crypto.randomUUID();
    setCookie(c, "user_id", userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });
  }
  return userId;
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
