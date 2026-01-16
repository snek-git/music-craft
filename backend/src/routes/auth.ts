import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getCurrentUser,
} from "../services/spotify";
import { authLimiter } from "../middleware/rateLimit";

const app = new Hono();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5173";

// Helper to create session token
async function createSessionToken(userId: string): Promise<string> {
  return await sign({ userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, JWT_SECRET);
}

// Helper to verify session token
async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    return { userId: payload.userId as string };
  } catch {
    return null;
  }
}

// GET /api/auth/login - Start OAuth flow
app.get("/login", authLimiter, (c) => {
  console.log("Login endpoint hit!");
  const state = crypto.randomUUID();
  const authUrl = getAuthorizationUrl(state);
  console.log("Redirecting to:", authUrl);

  // Store state in cookie for CSRF protection
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600, // 10 minutes
  });

  return c.redirect(authUrl);
});

// GET /api/auth/callback - Handle OAuth callback
app.get("/callback", authLimiter, async (c) => {
  console.log("Callback hit!");
  console.log("Query params:", { code: c.req.query("code")?.slice(0,10), state: c.req.query("state"), error: c.req.query("error") });

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const storedState = getCookie(c, "oauth_state");
  console.log("Stored state:", storedState);

  // Clear state cookie
  deleteCookie(c, "oauth_state");

  if (error) {
    console.log("Spotify returned error:", error);
    return c.redirect(`${FRONTEND_URL}?error=access_denied`);
  }

  if (!code || !state || state !== storedState) {
    console.log("State mismatch! state:", state, "storedState:", storedState);
    return c.redirect(`${FRONTEND_URL}?error=invalid_state`);
  }

  try {
    // Exchange code for tokens
    console.log("Exchanging code for tokens...");
    const tokens = await exchangeCodeForTokens(code);
    console.log("Got tokens!");

    // Get user profile
    console.log("Getting user profile...");
    const spotifyUser = await getCurrentUser(tokens.access_token);
    console.log("Got user:", spotifyUser.display_name);

    // Check if user exists
    let user = await db.query.users.findFirst({
      where: eq(users.spotifyId, spotifyUser.id),
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);

    if (user) {
      // Update existing user
      await db
        .update(users)
        .set({
          displayName: spotifyUser.display_name,
          email: spotifyUser.email,
          avatarUrl: spotifyUser.images?.[0]?.url,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    } else {
      // Create new user
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        spotifyId: spotifyUser.id,
        displayName: spotifyUser.display_name,
        email: spotifyUser.email,
        avatarUrl: spotifyUser.images?.[0]?.url,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      user = await db.query.users.findFirst({
        where: eq(users.spotifyId, spotifyUser.id),
      });
    }

    if (!user) {
      console.log("User creation failed!");
      return c.redirect(`${FRONTEND_URL}?error=user_creation_failed`);
    }

    console.log("User found/created:", user.id);

    // Create session token
    const sessionToken = await createSessionToken(user.id);
    console.log("Session token created:", sessionToken.slice(0, 20) + "...");

    // Set session cookie (httpOnly for security)
    setCookie(c, "session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    console.log("Redirecting to frontend with session cookie");
    return c.redirect(`${FRONTEND_URL}?auth=success`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return c.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

// GET /api/auth/me - Get current user
app.get("/me", async (c) => {
  // Check Authorization header first, then fall back to cookie
  let sessionToken = null;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    sessionToken = authHeader.slice(7);
  } else {
    sessionToken = getCookie(c, "session");
  }

  if (!sessionToken) {
    return c.json({ user: null });
  }

  const session = await verifySessionToken(sessionToken);
  if (!session) {
    return c.json({ user: null });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    deleteCookie(c, "session");
    return c.json({ user: null });
  }

  // Don't send tokens to frontend
  return c.json({
    user: {
      id: user.id,
      spotifyId: user.spotifyId,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  });
});

// POST /api/auth/logout - Logout
app.post("/logout", (c) => {
  deleteCookie(c, "session");
  return c.json({ success: true });
});

export default app;
