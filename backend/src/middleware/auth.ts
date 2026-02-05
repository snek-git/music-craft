import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { refreshAccessToken } from "../services/spotify";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// Extract session token from Authorization header or cookie
function getSessionToken(c: Context): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return getCookie(c, "session") || null;
}

// Verify a JWT session token and return the userId
export async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    return { userId: payload.userId as string };
  } catch {
    return null;
  }
}

// Middleware that requires authentication, loads user, and refreshes Spotify tokens if needed
export async function requireAuth(c: Context, next: Next) {
  const sessionToken = getSessionToken(c);

  if (!sessionToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verify(sessionToken, JWT_SECRET, "HS256");
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId as string),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    // Check if Spotify token needs refresh
    const now = new Date();
    if (user.tokenExpiresAt <= now) {
      try {
        const tokens = await refreshAccessToken(user.refreshToken);
        const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);

        await db
          .update(users)
          .set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));

        user.accessToken = tokens.access_token;
        user.refreshToken = tokens.refresh_token;
        user.tokenExpiresAt = expiresAt;
      } catch (error) {
        console.error("Token refresh failed:", error);
        return c.json({ error: "Token refresh failed" }, 401);
      }
    }

    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "Invalid session" }, 401);
  }
}
