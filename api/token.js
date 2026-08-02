const { generateEditCode, generatePaymentToken, getSiteUrl, getSupabase, hashSecret, json, makeSlug } = require("./_lib/tapdeck");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

    const url = new URL(req.url, "http://localhost");
    const action = String(url.searchParams.get("action") || "").toLowerCase();

    if (action === "generate") {
      const adminKey = String(url.searchParams.get("adminKey") || "").trim();
      if (!process.env.TOKEN_ADMIN_KEY || adminKey !== process.env.TOKEN_ADMIN_KEY) {
        return json(res, 401, { ok: false, error: "Unauthorized" });
      }
      const token = generateEditCode().replace(/-/g, "") + generateEditCode().replace(/-/g, "");
      const { error } = await supabase
        .from("tap_deck_tokens")
        .insert({ token_hash: hashSecret(token, "TOKEN") });
      if (error) throw error;
      return json(res, 200, { ok: true, token });
    }

    if (action === "redeem") {
      const token = String(url.searchParams.get("token") || "").trim();
      const slug = makeSlug(url.searchParams.get("slug"));
      const theme = String(url.searchParams.get("theme") || "").replace(/^\/?themes\//i, "").replace(/^\/+/, "").trim();
      if (!token) return json(res, 400, { ok: false, error: "Missing token" });
      if (!slug || !theme) return json(res, 400, { ok: false, error: "Missing slug or theme" });

      const tokenHash = hashSecret(token, "TOKEN");
      const { data, error } = await supabase
        .from("tap_deck_tokens")
        .select("token_hash, used_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.used_at) return json(res, 401, { ok: false, error: "Token rejected" });

      const { error: updateError } = await supabase
        .from("tap_deck_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token_hash", tokenHash);
      if (updateError) throw updateError;

      const paymentToken = generatePaymentToken();
      const { data: session, error: sessionError } = await supabase
        .from("tap_deck_payment_sessions")
        .insert({
          slug,
          theme,
          token_hash: hashSecret(paymentToken, "PAYMENT"),
          status: "paid",
          amount_cents: 0,
          paid_at: new Date().toISOString()
        })
        .select("*")
        .single();
      if (sessionError) throw sessionError;

      const params = new URLSearchParams({ session: session.id, token: paymentToken, slug, theme });
      return json(res, 200, {
        ok: true,
        redeemed: true,
        formUrl: `${getSiteUrl()}/intake?${params.toString()}`
      });
    }

    return json(res, 400, { ok: false, error: "Unknown action" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
