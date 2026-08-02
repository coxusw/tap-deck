const {
  clientExists,
  createOrReplaceEditCode,
  getSupabase,
  hashSecret,
  json,
  makeSlug,
  parseBody,
  saveClient,
  sendLiveEmail,
  toClientJson,
  uploadLogo
} = require("./_lib/tapdeck");

async function getPaidSession(body, slug) {
  const sessionId = String(body.paymentSessionId || "").trim();
  const token = String(body.paymentToken || "").trim();
  if (!sessionId || !token) throw new Error("Confirmed payment is required before submitting the intake form.");

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("tap_deck_payment_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.token_hash !== hashSecret(token, "PAYMENT")) {
    throw new Error("Invalid payment session.");
  }
  if (data.slug !== slug) throw new Error("Payment session does not match this slug.");
  if (data.status !== "paid") throw new Error("Payment has not been confirmed.");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("Payment session expired.");
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body = await parseBody(req);
    const slug = makeSlug(body.slug || body.clientJson?.slug);
    if (!slug) return json(res, 400, { ok: false, error: "Missing slug" });

    let paidSession;
    try {
      paidSession = await getPaidSession(body, slug);
    } catch (err) {
      return json(res, 402, { ok: false, error: err.message || "Confirmed payment is required." });
    }

    if (await clientExists(slug)) {
      return json(res, 409, { ok: false, error: "That slug is already taken." });
    }

    const clientInput = toClientJson({ ...(body.clientJson || body), slug });
    if (!clientInput.contact.email) {
      return json(res, 400, { ok: false, error: "Email is required." });
    }

    if (body.logoBase64) {
      clientInput.logoPath = await uploadLogo(slug, body.logoBase64, body.logoExt || "png");
    }

    const client = await saveClient(clientInput, "intake");
    const editCode = await createOrReplaceEditCode(slug);
    await sendLiveEmail(client, editCode);

    const supabase = getSupabase();
    await supabase
      .from("tap_deck_payment_sessions")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", paidSession.id);

    const response = { ok: true, slug, client };
    if (process.env.TAP_DECK_RETURN_EDIT_CODE === "true") response.editCode = editCode;
    return json(res, 200, response);
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
