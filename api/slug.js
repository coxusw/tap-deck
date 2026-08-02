const { clientExists, json, makeSlug, RESERVED_SLUGS } = require("./_lib/tapdeck");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const url = new URL(req.url, "http://localhost");
    const slug = makeSlug(url.searchParams.get("slug"));
    if (!slug) return json(res, 400, { ok: false, available: false, error: "Missing slug" });
    if (RESERVED_SLUGS.has(slug)) return json(res, 200, { ok: true, slug, available: false, reserved: true });

    const exists = await clientExists(slug);
    return json(res, 200, { ok: true, slug, available: !exists });
  } catch (err) {
    return json(res, 500, { ok: false, available: false, error: err.message || String(err) });
  }
};
