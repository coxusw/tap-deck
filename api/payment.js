const {
  clientExists,
  generatePaymentToken,
  getSiteUrl,
  getSupabase,
  hashSecret,
  json,
  makeSlug,
  parseBody
} = require("./_lib/tapdeck");

function squareBaseUrl() {
  return String(process.env.SQUARE_ENVIRONMENT || "production").toLowerCase() === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function squareHeaders() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not configured.");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": process.env.SQUARE_API_VERSION || "2026-05-20"
  };
}

function getPriceCents() {
  const cents = Number(process.env.SQUARE_PROFILE_PRICE_CENTS || 0);
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("SQUARE_PROFILE_PRICE_CENTS is not configured.");
  return cents;
}

function publicSession(row, token) {
  const params = new URLSearchParams({ session: row.id, token });
  if (row.theme) params.set("theme", row.theme);
  if (row.slug) params.set("slug", row.slug);
  return {
    id: row.id,
    slug: row.slug,
    theme: row.theme,
    status: row.status,
    formUrl: `${getSiteUrl()}/intake?${params.toString()}`
  };
}

async function createSquarePaymentLink(sessionId, token, slug, theme, amountCents) {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) throw new Error("SQUARE_LOCATION_ID is not configured.");

  const siteUrl = getSiteUrl();
  const redirect = new URL("/pay/success", siteUrl);
  redirect.searchParams.set("session", sessionId);
  redirect.searchParams.set("token", token);
  redirect.searchParams.set("slug", slug);
  if (theme) redirect.searchParams.set("theme", theme);

  const body = {
    idempotency_key: `tap-deck-${sessionId}`,
    order: {
      location_id: locationId,
      reference_id: sessionId,
      line_items: [
        {
          name: "Tap-Deck Profile Activation",
          quantity: "1",
          base_price_money: {
            amount: amountCents,
            currency: "USD"
          },
          note: `Slug: ${slug}`
        }
      ]
    },
    checkout_options: {
      redirect_url: redirect.toString()
    }
  };

  const res = await fetch(`${squareBaseUrl()}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: squareHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.errors?.map((err) => err.detail || err.code).filter(Boolean).join("; ");
    throw new Error(`Square checkout failed: ${detail || res.status}`);
  }
  return data.payment_link;
}

async function verifySquarePayment(session, paymentId) {
  if (!paymentId) return false;
  const res = await fetch(`${squareBaseUrl()}/v2/payments/${encodeURIComponent(paymentId)}`, {
    headers: squareHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return false;
  const payment = data.payment;
  if (!payment || payment.status !== "COMPLETED") return false;
  if (payment.order_id && session.square_order_id && payment.order_id !== session.square_order_id) return false;
  return true;
}

async function handleStart(req, res) {
  const body = await parseBody(req);
  const slug = makeSlug(body.slug);
  const theme = String(body.theme || "").replace(/^\/?themes\//i, "").replace(/^\/+/, "").trim();
  if (!slug || !theme) return json(res, 400, { ok: false, error: "Missing slug or theme." });
  if (await clientExists(slug)) return json(res, 409, { ok: false, error: "That slug is already taken." });

  const supabase = getSupabase();
  if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

  const token = generatePaymentToken();
  const amountCents = getPriceCents();
  const { data: inserted, error } = await supabase
    .from("tap_deck_payment_sessions")
    .insert({
      slug,
      theme,
      token_hash: hashSecret(token, "PAYMENT"),
      amount_cents: amountCents,
      currency: "USD"
    })
    .select("*")
    .single();
  if (error) throw error;

  const paymentLink = await createSquarePaymentLink(inserted.id, token, slug, theme, amountCents);
  const { data: updated, error: updateError } = await supabase
    .from("tap_deck_payment_sessions")
    .update({
      square_payment_link_id: paymentLink?.id || "",
      square_order_id: paymentLink?.order_id || "",
      square_checkout_url: paymentLink?.url || ""
    })
    .eq("id", inserted.id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return json(res, 200, {
    ok: true,
    checkoutUrl: updated.square_checkout_url,
    session: publicSession(updated, token)
  });
}

async function findSession(supabase, sessionId, token) {
  const { data, error } = await supabase
    .from("tap_deck_payment_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.token_hash !== hashSecret(token, "PAYMENT")) return null;
  return data;
}

async function handleConfirm(req, res, url) {
  const supabase = getSupabase();
  if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

  const sessionId = String(url.searchParams.get("session") || "").trim();
  const token = String(url.searchParams.get("token") || "").trim();
  const paymentId = String(url.searchParams.get("transactionId") || url.searchParams.get("paymentId") || "").trim();
  if (!sessionId || !token) return json(res, 400, { ok: false, error: "Missing payment session." });

  const session = await findSession(supabase, sessionId, token);
  if (!session) return json(res, 401, { ok: false, error: "Invalid payment session." });

  if (session.status !== "paid" && session.status !== "used") {
    const paid = await verifySquarePayment(session, paymentId);
    if (paid) {
      const { data, error } = await supabase
        .from("tap_deck_payment_sessions")
        .update({ status: "paid", square_payment_id: paymentId, paid_at: new Date().toISOString() })
        .eq("id", session.id)
        .select("*")
        .single();
      if (error) throw error;
      return json(res, 200, { ok: true, paid: true, session: publicSession(data, token) });
    }
  }

  return json(res, 200, {
    ok: true,
    paid: session.status === "paid" || session.status === "used",
    session: publicSession(session, token)
  });
}

async function handleStatus(req, res, url) {
  const supabase = getSupabase();
  if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

  const sessionId = String(url.searchParams.get("session") || "").trim();
  const token = String(url.searchParams.get("token") || "").trim();
  if (!sessionId || !token) return json(res, 400, { ok: false, error: "Missing payment session." });

  const session = await findSession(supabase, sessionId, token);
  if (!session) return json(res, 401, { ok: false, error: "Invalid payment session." });
  return json(res, 200, { ok: true, paid: session.status === "paid" || session.status === "used", session: publicSession(session, token) });
}

async function handleRedeem(req, res) {
  const body = await parseBody(req);
  const sessionId = String(body.paymentSessionId || "").trim();
  const token = String(body.paymentToken || "").trim();
  const slug = makeSlug(body.slug);
  const supabase = getSupabase();
  if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

  const session = await findSession(supabase, sessionId, token);
  if (!session) return json(res, 401, { ok: false, error: "Invalid payment session." });
  if (session.status !== "paid") return json(res, 402, { ok: false, error: "Payment has not been confirmed." });
  if (session.slug !== slug) return json(res, 400, { ok: false, error: "Payment session does not match this slug." });
  if (new Date(session.expires_at).getTime() < Date.now()) return json(res, 410, { ok: false, error: "Payment session expired." });

  return json(res, 200, { ok: true, session });
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const action = String(url.searchParams.get("action") || "").toLowerCase();
    if (req.method === "POST" && action === "start") return handleStart(req, res);
    if (req.method === "GET" && action === "confirm") return handleConfirm(req, res, url);
    if (req.method === "GET" && action === "status") return handleStatus(req, res, url);
    if (req.method === "POST" && action === "redeem") return handleRedeem(req, res);
    return json(res, 400, { ok: false, error: "Unknown action" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
