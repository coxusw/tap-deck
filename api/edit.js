const {
  createOrReplaceEditCode,
  findClientByEmail,
  getClient,
  json,
  makeSlug,
  parseBody,
  saveClient,
  sendEditCodeEmail,
  sendNoProfileEmail,
  toClientJson,
  uploadLogo,
  validateEditCode
} = require("./_lib/tapdeck");

async function handleGet(req, res) {
  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").toLowerCase();
  const slug = makeSlug(url.searchParams.get("slug"));
  const editCode = String(url.searchParams.get("editCode") || "").trim();

  if (action === "verifyedit") {
    if (!slug || !editCode) return json(res, 400, { ok: false, error: "Missing slug or editCode" });
    const valid = await validateEditCode(slug, editCode);
    return json(res, 200, { ok: valid, valid });
  }

  if (action === "getclientforedit") {
    if (!slug || !editCode) return json(res, 400, { ok: false, error: "Missing slug or editCode" });
    const valid = await validateEditCode(slug, editCode);
    if (!valid) return json(res, 401, { ok: false, error: "Invalid edit code" });
    const client = await getClient(slug);
    if (!client) return json(res, 404, { ok: false, error: "Profile not found" });
    return json(res, 200, { ok: true, client });
  }

  if (action === "requesteditcode") {
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return json(res, 400, { ok: false, error: "Missing email" });

    const client = await findClientByEmail(email);
    if (client) {
      const code = await createOrReplaceEditCode(client.slug);
      await sendEditCodeEmail(client, code);
    } else {
      await sendNoProfileEmail(email);
    }

    return json(res, 200, { ok: true, sent: true, matchedProfile: Boolean(client) });
  }

  if (action === "sendeditcode") {
    const adminKey = String(url.searchParams.get("adminKey") || "").trim();
    if (!process.env.TOKEN_ADMIN_KEY || adminKey !== process.env.TOKEN_ADMIN_KEY) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (!slug) return json(res, 400, { ok: false, error: "Missing slug" });
    const client = await getClient(slug);
    if (!client) return json(res, 404, { ok: false, error: "Profile not found" });
    const code = await createOrReplaceEditCode(slug);
    await sendEditCodeEmail(client, code);
    return json(res, 200, { ok: true, slug, email: client.contact?.email || "" });
  }

  return json(res, 400, { ok: false, error: "Unknown action" });
}

async function handlePost(req, res) {
  const body = await parseBody(req);
  const action = String(body.action || "").toLowerCase();
  if (action !== "updateprofile") return json(res, 400, { ok: false, error: "Unknown action" });

  const slug = makeSlug(body.slug || body.clientJson?.slug);
  const editCode = String(body.editCode || "").trim();
  if (!slug || !editCode) return json(res, 400, { ok: false, error: "Missing slug or editCode" });

  const valid = await validateEditCode(slug, editCode);
  if (!valid) return json(res, 401, { ok: false, error: "Invalid edit code" });

  const existing = await getClient(slug);
  if (!existing) return json(res, 404, { ok: false, error: "Profile not found" });

  const client = toClientJson({ ...(body.clientJson || {}), slug }, existing);
  if (body.logoBase64) {
    client.logoPath = await uploadLogo(slug, body.logoBase64, body.logoExt || "png");
  }

  const saved = await saveClient(client, "edit");
  return json(res, 200, { ok: true, slug, client: saved, liveLink: `${process.env.PUBLIC_SITE_URL || "https://www.tap-deck.com"}/${slug}` });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
