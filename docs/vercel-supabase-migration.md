# Tap-Deck Vercel + Supabase Migration

This migration keeps the current Google Sheets/App Script/GitHub Pages flow available while the Vercel + Supabase path is configured and tested.

## What Changed

- Static pages remain in place.
- New Vercel API routes live in `api/`.
- Profile reads try Supabase first, then fall back to existing `data/clients/*.json`.
- Current GitHub Pages behavior is protected with client-side legacy fallbacks.
- The intake page at `/intake/` now submits to `/api/intake` instead of embedding Google Forms.

## Supabase Setup

Use the SQL migration in:

```text
supabase/migrations/20260601144000_tap_deck.sql
supabase/migrations/20260601172000_square_payment_sessions.sql
```

Run it in the Supabase SQL editor for the `Crested Critters` project, or link the CLI to project ref `ffrzcgobqyhrssfyqczi` and run `supabase db push`.

Required Vercel environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=tap-deck-assets
TOKEN_SALT
TOKEN_ADMIN_KEY
PUBLIC_SITE_URL=https://www.tap-deck.com
SUPPORT_REPLY_TO=support@tap-deck.com
SQUARE_ENVIRONMENT=production
SQUARE_ACCESS_TOKEN
SQUARE_LOCATION_ID
SQUARE_PROFILE_PRICE_CENTS
SQUARE_WEBHOOK_SIGNATURE_KEY
SQUARE_WEBHOOK_URL=https://www.tap-deck.com/api/square-webhook
RESEND_API_KEY
RESEND_FROM=Tap-Deck <support@tap-deck.com>
```

For Zoho Mail, use SMTP instead of Resend:

```text
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=support@tap-deck.com
SMTP_PASS=<Zoho application-specific password>
SMTP_FROM=Tap-Deck <support@tap-deck.com>
```

`RESEND_API_KEY` is optional if SMTP is configured.

## Data Import

After env vars are present locally:

```bash
npm run migrate:clients
```

This imports the existing static client JSON files into `tap_deck_profiles`.

## Vercel Note

The existing Vercel project `crestedcritters-platform` currently serves `shop.crestedcritters.com`. Do not link/deploy this repo into that project unless you intend Tap-Deck to share that app and have confirmed the routing/domain setup. A separate Vercel project in the same account is safer for `www.tap-deck.com`.
