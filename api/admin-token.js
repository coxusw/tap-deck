const crypto = require("crypto");
const QRCode = require("qrcode");
const {
  generateEditCode,
  getSupabase,
  hashSecret,
  json,
  makeSlug,
  parseBody
} = require("./_lib/tapdeck");

const COOKIE_NAME = "tapdeck_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signSession(issuedAt) {
  const secret = process.env.TOKEN_ADMIN_KEY;
  if (!secret) throw new Error("TOKEN_ADMIN_KEY is not configured.");
  return crypto
    .createHmac("sha256", secret)
    .update(`tapdeck-admin:${issuedAt}`)
    .digest("base64url");
}

function makeSessionValue() {
  const issuedAt = Date.now().toString(36);
  return `${issuedAt}.${signSession(issuedAt)}`;
}

function getCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

function validSession(req) {
  const value = getCookie(req, COOKIE_NAME);
  const [issuedAt, signature] = value.split(".");
  if (!issuedAt || !signature) return false;

  const issuedMs = parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedMs)) return false;

  const ageMs = Date.now() - issuedMs;
  if (ageMs < 0 || ageMs > SESSION_MAX_AGE_SECONDS * 1000) return false;

  return safeEqual(signature, signSession(issuedAt));
}

function setSessionCookie(res) {
  const value = encodeURIComponent(makeSessionValue());
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );
}

async function body(req) {
  try {
    return await parseBody(req);
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!process.env.TOKEN_ADMIN_KEY) {
      return json(res, 500, { ok: false, error: "TOKEN_ADMIN_KEY is not configured." });
    }

    const url = new URL(req.url, "http://localhost");
    const action = String(url.searchParams.get("action") || "").toLowerCase();

    if (action === "status") {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
      return json(res, 200, { ok: true, authenticated: validSession(req) });
    }

    if (action === "login") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
      const data = await body(req);
      if (!safeEqual(data.adminKey, process.env.TOKEN_ADMIN_KEY)) {
        return json(res, 401, { ok: false, error: "Invalid admin key." });
      }
      setSessionCookie(res);
      return json(res, 200, { ok: true, authenticated: true });
    }

    if (action === "logout") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (!validSession(req)) {
      return json(res, 401, { ok: false, error: "Admin login required." });
    }

    if (action === "generate") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

      const supabase = getSupabase();
      if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

      const token = generateEditCode().replace(/-/g, "") + generateEditCode().replace(/-/g, "");
      const { error } = await supabase
        .from("tap_deck_tokens")
        .insert({ token_hash: hashSecret(token, "TOKEN") });
      if (error) throw error;

      return json(res, 200, { ok: true, token });
    }


    if (action === "profiles" || action === "accounts") {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

      const supabase = getSupabase();
      if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

      const { data, error } = await supabase
        .from("tap_deck_profiles")
        .select("slug, business_name, theme, created_at, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const accounts = (data || []).map((row) => ({
        slug: row.slug,
        businessName: row.business_name || "",
        theme: row.theme || "",
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
      }));

      return json(res, 200, { ok: true, count: accounts.length, accounts });
    }

    if (action === "delete-profile") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

      const supabase = getSupabase();
      if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

      const data = await body(req);
      const slug = makeSlug(data.slug);
      const confirmSlug = String(data.confirmSlug || "").trim().toLowerCase();

      if (!slug) return json(res, 400, { ok: false, error: "Missing profile slug." });
      if (confirmSlug !== slug) {
        return json(res, 400, { ok: false, error: "Confirmation slug does not match." });
      }

      const { data: deleted, error } = await supabase
        .from("tap_deck_profiles")
        .delete()
        .eq("slug", slug)
        .select("slug")
        .maybeSingle();
      if (error) throw error;
      if (!deleted) return json(res, 404, { ok: false, error: "Profile not found." });

      return json(res, 200, { ok: true, deletedSlug: deleted.slug });
    }

    if (action === "qr") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
      const data = await body(req);
      const token = String(data.token || "").trim();
      if (!token) return json(res, 400, { ok: false, error: "Missing token." });

      const dataUrl = await QRCode.toDataURL(token, {
        margin: 2,
        width: 720,
        errorCorrectionLevel: "M"
      });
      return json(res, 200, { ok: true, dataUrl });
    }

    return json(res, 400, { ok: false, error: "Unknown action." });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
