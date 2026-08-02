const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "assets",
  "data",
  "edit",
  "intake",
  "logos",
  "pay",
  "preview",
  "shop",
  "theme-gallery",
  "themes",
  "vcards"
]);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function makeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function normalizeHandleOrUrl(value, kind) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  if (kind === "instagram") {
    if (s.startsWith("@")) return `https://instagram.com/${s.slice(1)}`;
    if (!s.includes(".") && !s.includes("/") && !s.includes(" ")) return `https://instagram.com/${s}`;
  }

  if (kind === "venmo") {
    if (s.startsWith("@")) return `https://venmo.com/${s.slice(1)}`;
    if (!s.includes(".") && !s.includes("/") && !s.includes(" ")) return `https://venmo.com/${s}`;
  }

  if (kind === "cashapp") {
    if (s.startsWith("$")) return `https://cash.app/${s}`;
    if (!s.includes(".") && !s.includes("/") && !s.includes(" ")) return `https://cash.app/$${s.replace(/^\$/, "")}`;
  }

  return `https://${s}`;
}

function normalizePhoneE164(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const only = digits.replace(/[^\d]/g, "");
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith("1")) return `+${only}`;
  return "";
}

function getSiteUrl() {
  return String(process.env.PUBLIC_SITE_URL || "https://www.tap-deck.com").replace(/\/+$/, "");
}

function getBucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET || "tap-deck-assets";
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function toClientJson(input = {}, existing = {}) {
  const slug = makeSlug(input.slug || existing.slug);
  const links = input.links || {};
  const contact = input.contact || {};
  const phoneDisplay = String(contact.phoneDisplay || contact.phone || existing.contact?.phoneDisplay || "").trim();
  const phoneE164 = normalizePhoneE164(contact.phoneE164 || contact.phone || phoneDisplay);

  return {
    slug,
    businessName: String(input.businessName || existing.businessName || "").trim(),
    tagline: String(input.tagline || existing.tagline || "").trim(),
    about: String(input.about || existing.about || "").trim(),
    links: {
      website: normalizeUrl(links.website || existing.links?.website || ""),
      facebook: normalizeUrl(links.facebook || existing.links?.facebook || ""),
      instagram: normalizeHandleOrUrl(links.instagram || existing.links?.instagram || "", "instagram"),
      tiktok: normalizeUrl(links.tiktok || existing.links?.tiktok || ""),
      youtube: normalizeUrl(links.youtube || existing.links?.youtube || ""),
      booksy: normalizeUrl(links.booksy || existing.links?.booksy || ""),
      other: normalizeUrl(links.other || existing.links?.other || ""),
      linkedin: normalizeUrl(links.linkedin || existing.links?.linkedin || ""),
      paypal: normalizeUrl(links.paypal || existing.links?.paypal || ""),
      cashapp: normalizeHandleOrUrl(links.cashapp || existing.links?.cashapp || "", "cashapp"),
      venmo: normalizeHandleOrUrl(links.venmo || existing.links?.venmo || "", "venmo")
    },
    contact: {
      name: String(contact.name || existing.contact?.name || "").trim(),
      phoneE164,
      phoneDisplay,
      email: String(contact.email || existing.contact?.email || "").trim()
    },
    theme: String(input.theme || existing.theme || "").replace(/^\/?themes\//i, "").replace(/^\/+/, "").trim(),
    logoPath: String(input.logoPath || existing.logoPath || "").trim(),
    vcardPath: `/api/vcard?slug=${encodeURIComponent(slug)}`,
    qrPath: `/api/qr?slug=${encodeURIComponent(slug)}`
  };
}

function rowToClient(row) {
  if (!row) return null;
  const profile = row.profile || {};
  return toClientJson({
    ...profile,
    slug: row.slug,
    businessName: row.business_name,
    tagline: row.tagline,
    about: row.about,
    links: row.links,
    contact: row.contact,
    theme: row.theme,
    logoPath: row.logo_path,
    qrPath: row.qr_path,
    vcardPath: row.vcard_path
  }, profile);
}

async function getStaticClient(slug) {
  try {
    const file = path.join(process.cwd(), "data", "clients", `${slug}.json`);
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getClient(slug) {
  const safeSlug = makeSlug(slug);
  if (!safeSlug) return null;

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("tap_deck_profiles")
      .select("*")
      .eq("slug", safeSlug)
      .maybeSingle();
    if (error) throw error;
    if (data) return rowToClient(data);
  }

  return getStaticClient(safeSlug);
}

async function clientExists(slug) {
  const safeSlug = makeSlug(slug);
  if (!safeSlug || RESERVED_SLUGS.has(safeSlug)) return true;
  return Boolean(await getClient(safeSlug));
}

async function findClientByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;

  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("tap_deck_profiles")
      .select("*")
      .filter("contact->>email", "eq", target)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return rowToClient(data);
  }

  const dir = path.join(process.cwd(), "data", "clients");
  try {
    const files = await fs.readdir(dir);
    for (const file of files.filter((name) => name.toLowerCase().endsWith(".json"))) {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const client = JSON.parse(raw);
      if (String(client.contact?.email || "").trim().toLowerCase() === target) return client;
    }
  } catch {
    return null;
  }

  return null;
}

async function saveClient(client, source = "supabase") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const profile = toClientJson(client);
  const row = {
    slug: profile.slug,
    business_name: profile.businessName,
    tagline: profile.tagline,
    about: profile.about,
    links: profile.links,
    contact: profile.contact,
    theme: profile.theme,
    logo_path: profile.logoPath || "",
    qr_path: profile.qrPath || "",
    vcard_path: profile.vcardPath || "",
    profile,
    source
  };

  const { error } = await supabase.from("tap_deck_profiles").upsert(row, { onConflict: "slug" });
  if (error) throw error;
  return profile;
}

function generateEditCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${pick(3)}-${pick(4)}-${pick(4)}`;
}

function generatePaymentToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashSecret(value, namespace = "EDIT") {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error("TOKEN_SALT is not configured.");
  return crypto.createHash("sha256").update(`${salt}::${namespace}::${String(value || "")}`).digest("hex");
}

async function createOrReplaceEditCode(slug) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const code = generateEditCode();
  const { error } = await supabase
    .from("tap_deck_edit_codes")
    .upsert({ slug, code_hash: hashSecret(code, "EDIT") }, { onConflict: "slug" });
  if (error) throw error;
  return code;
}

async function validateEditCode(slug, editCode) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("tap_deck_edit_codes")
    .select("code_hash")
    .eq("slug", makeSlug(slug))
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return data.code_hash === hashSecret(editCode, "EDIT");
}

async function uploadLogo(slug, base64, ext = "png") {
  const supabase = getSupabase();
  if (!supabase || !base64) return "";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(String(ext).toLowerCase()) ? String(ext).toLowerCase().replace("jpeg", "jpg") : "png";
  const bytes = Buffer.from(base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ""), "base64");
  const contentType = cleanExt === "jpg" ? "image/jpeg" : `image/${cleanExt}`;
  const filePath = `logos/${makeSlug(slug)}.${cleanExt}`;
  const { error } = await supabase.storage.from(getBucketName()).upload(filePath, bytes, {
    contentType,
    upsert: true
  });
  if (error) throw error;
  const { data } = supabase.storage.from(getBucketName()).getPublicUrl(filePath);
  return data.publicUrl;
}

function buildVcard(client) {
  const esc = (s) => String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
  const fullName = client.contact?.name || client.businessName || "Tap-Deck Profile";
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(fullName)}`];
  if (client.businessName) lines.push(`ORG:${esc(client.businessName)}`);
  if (client.contact?.phoneE164) lines.push(`TEL;TYPE=CELL:${esc(client.contact.phoneE164)}`);
  if (client.contact?.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(client.contact.email)}`);
  if (client.links?.website) lines.push(`URL:${esc(client.links.website)}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function sendEmail(to, subject, html, textBody) {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") !== "false",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.RESEND_FROM || "Tap-Deck <support@tap-deck.com>",
      to,
      subject,
      html,
      text: textBody,
      replyTo: process.env.SUPPORT_REPLY_TO || "support@tap-deck.com"
    });

    return { ok: true, via: "smtp" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return { ok: false, skipped: true };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Tap-Deck <support@tap-deck.com>",
      to,
      subject,
      html,
      text: textBody,
      reply_to: process.env.SUPPORT_REPLY_TO || "support@tap-deck.com"
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Email failed: ${res.status} ${body}`);
  }

  return { ok: true };
}

async function sendLiveEmail(client, editCode) {
  const email = client.contact?.email;
  const liveLink = `${getSiteUrl()}/${client.slug}`;
  const qrLink = `${getSiteUrl()}${client.qrPath}`;
  return sendEmail(
    email,
    "Your Tap-Deck profile is live",
    `<p>Here is your profile link:</p><p><a href="${liveLink}">${liveLink}</a></p><p>Your QR code: <a href="${qrLink}">${qrLink}</a></p><p><b>Your Edit Code:</b><br>${editCode}</p>`,
    `Here is your profile link:\n${liveLink}\n\nYour QR code:\n${qrLink}\n\nYour Edit Code: ${editCode}`
  );
}

async function sendEditCodeEmail(client, editCode) {
  const liveLink = `${getSiteUrl()}/${client.slug}`;
  const editLink = `${getSiteUrl()}/edit?slug=${encodeURIComponent(client.slug)}`;
  return sendEmail(
    client.contact?.email,
    "Your Tap-Deck edit code",
    `<p>Your Tap-Deck edit code is:</p><p><b>${editCode}</b></p><p>Profile: <a href="${liveLink}">${liveLink}</a></p><p>Edit: <a href="${editLink}">${editLink}</a></p>`,
    `Your Tap-Deck edit code is:\n${editCode}\n\nProfile: ${liveLink}\nEdit: ${editLink}`
  );
}

async function sendNoProfileEmail(email) {
  const startLink = `${getSiteUrl()}/theme-gallery`;
  return sendEmail(
    email,
    "No active Tap-Deck profile found",
    `<p>We could not find an active Tap-Deck profile connected to this email address.</p><p>If you already have a Tap-Deck profile, try requesting your edit code again with the email address that was used when the profile was created.</p><p>If you need a new Tap-Deck profile, start here to choose your profile link and theme, then activate your profile through the payment step: <a href="${startLink}">${startLink}</a></p>`,
    `We could not find an active Tap-Deck profile connected to this email address.\n\nIf you already have a Tap-Deck profile, try requesting your edit code again with the email address that was used when the profile was created.\n\nIf you need a new Tap-Deck profile, start here to choose your profile link and theme, then activate your profile through the payment step:\n${startLink}`
  );
}

module.exports = {
  RESERVED_SLUGS,
  buildVcard,
  clientExists,
  createOrReplaceEditCode,
  findClientByEmail,
  generateEditCode,
  generatePaymentToken,
  getClient,
  getSiteUrl,
  getSupabase,
  hashSecret,
  json,
  makeSlug,
  parseBody,
  saveClient,
  sendEditCodeEmail,
  sendLiveEmail,
  sendNoProfileEmail,
  text,
  toClientJson,
  uploadLogo,
  validateEditCode
};
