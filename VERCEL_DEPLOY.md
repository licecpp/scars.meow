# scarz.lol - Vercel deployment

This repository is configured for the Supabase + Vercel Blob architecture.

## Required services
- Supabase: database/auth data
- Vercel Blob: uploaded media
- Vercel: Next.js hosting
- Optional integrations: Stripe, Resend, Discord OAuth, Cloudflare Turnstile, Last.fm

## Environment variables
Copy `.env.example` into Vercel Project Settings -> Environment Variables and fill in real values.
Never commit `.env` or secret keys.

## Build
- Framework: Next.js
- Install: `npm install`
- Build: `npm run build`

## Production URL
Set `NEXT_PUBLIC_SITE_URL` to your actual production URL, e.g. `https://scarz.lol`.


