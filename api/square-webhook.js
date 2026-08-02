const crypto = require("crypto");
const { getSiteUrl, getSupabase, json } = require("./_lib/tapdeck");

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function verifySquareSignature(req, body) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) return false;

  const signature = req.headers["x-square-hmacsha256-signature"];
  if (!signature) return false;

  const notificationUrl = process.env.SQUARE_WEBHOOK_URL || `${getSiteUrl()}/api/square-webhook`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(notificationUrl + body)
    .digest("base64");

  const a = Buffer.from(String(signature), "base64");
  const b = Buffer.from(expected, "base64");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body = await rawBody(req);
    if (!verifySquareSignature(req, body)) return json(res, 401, { ok: false, error: "Invalid signature" });

    const event = JSON.parse(body || "{}");
    const payment = event?.data?.object?.payment;
    if (!payment || payment.status !== "COMPLETED") return json(res, 200, { ok: true, ignored: true });

    const supabase = getSupabase();
    if (!supabase) return json(res, 500, { ok: false, error: "Supabase is not configured." });

    const orderId = payment.order_id || "";
    const paymentId = payment.id || "";
    if (!orderId && !paymentId) return json(res, 200, { ok: true, ignored: true });

    let query = supabase.from("tap_deck_payment_sessions");
    if (orderId) query = query.update({ status: "paid", square_payment_id: paymentId, paid_at: new Date().toISOString() }).eq("square_order_id", orderId);
    else query = query.update({ status: "paid", square_payment_id: paymentId, paid_at: new Date().toISOString() }).eq("square_payment_id", paymentId);

    const { error } = await query;
    if (error) throw error;
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
};
