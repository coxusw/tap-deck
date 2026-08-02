import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const clientsDir = path.join(process.cwd(), "data", "clients");
const files = (await fs.readdir(clientsDir)).filter((name) => name.toLowerCase().endsWith(".json"));

for (const file of files) {
  const raw = await fs.readFile(path.join(clientsDir, file), "utf8");
  const profile = JSON.parse(raw);
  const slug = String(profile.slug || file.replace(/\.json$/i, "")).trim().toLowerCase();

  const row = {
    slug,
    business_name: profile.businessName || "",
    tagline: profile.tagline || "",
    about: profile.about || "",
    links: profile.links || {},
    contact: profile.contact || {},
    theme: profile.theme || "",
    logo_path: profile.logoPath || "",
    qr_path: `/api/qr?slug=${encodeURIComponent(slug)}`,
    vcard_path: `/api/vcard?slug=${encodeURIComponent(slug)}`,
    profile: {
      ...profile,
      qrPath: `/api/qr?slug=${encodeURIComponent(slug)}`,
      vcardPath: `/api/vcard?slug=${encodeURIComponent(slug)}`
    },
    source: "static-migration"
  };

  const { error } = await supabase.from("tap_deck_profiles").upsert(row, { onConflict: "slug" });
  if (error) {
    console.error(`Failed ${slug}:`, error.message);
    process.exitCode = 1;
  } else {
    console.log(`Migrated ${slug}`);
  }
}
