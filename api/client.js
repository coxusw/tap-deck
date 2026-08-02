const { getClient, json, makeSlug } = require("./_lib/tapdeck");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const url = new URL(req.url, "http://localhost");
    const slug = makeSlug(url.searchParams.get("slug"));
    if (!slug) return json(res, 400, { ok: false, error: "Missing slug" });

    const client = await getClient(slug);
    if (!client) return json(res, 404, { ok: false, error: "Profile not found" });

    return json(res, 200, { ok: true, client });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
