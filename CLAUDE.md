# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AiM Skill is a Ukrainian-language management accounting (управлінський облік) web application for ТОВ "ЕЙМ СКІЛ" (EDRPOU 45505924). It handles document scanning via Claude API, transaction tracking, project management, bank reconciliation, cash management, and P&L reporting.

## Commands

```bash
npm install        # install dependencies
npm run dev        # start Vite dev server
npm run build      # production build
npm run preview    # preview production build
```

No test framework is configured. No linter is configured.

## Architecture

**Stack:** React 18 + Vite 5, Supabase (auth, Postgres, storage), Anthropic Claude API for document OCR, Recharts for charts, SheetJS (xlsx) for Excel export. No router library — page state is managed via `useState` in `App.jsx`.

**Key architectural patterns:**

- **No CSS framework** — all styles are defined as JS template literals in `src/lib/styles.js` (exported as `css` and `mobileCss`), injected via `<style>` tags in App.jsx. Tabler Icons loaded from CDN via webfont.
- **Flat component structure** — all pages are direct children of `App.jsx` via a `pages` object mapping page IDs to components. `Layout.jsx` provides the sidebar/mobile nav shell.
- **Role-based access** — four roles (`admin`, `accountant`, `manager`, `viewer`) enforced both in UI (component-level checks on `user.role`) and in Supabase RLS policies defined in `supabase_schema.sql`.
- **AI document extraction** — `src/lib/ai.js` sends document images/PDFs directly to Anthropic's Messages API from the browser (using `anthropic-dangerous-direct-browser-access` header). It extracts structured JSON from Ukrainian accounting documents.
- **Articles system** — `src/lib/articles.js` manages income/expense categories with client-side caching (1-min TTL).

**Environment variables** (set in `.env` or Vercel):
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key
- `VITE_ANTHROPIC_KEY` — Anthropic API key (used client-side)

**Supabase tables:** `profiles`, `projects`, `transactions`, `transaction_items`, `documents`, `articles`, `cash_transactions`, `bank_transactions`. Schema is in `supabase_schema.sql` (note: some tables like `articles`, `cash_transactions`, `bank_transactions` are referenced in code but not in the SQL file — they may have been added separately).

**UI language:** All user-facing text is in Ukrainian. The company identity is hardcoded in the AI system prompt in `src/lib/ai.js`.

## Deployment

Deployed via Vercel with auto-deploy from GitHub. Supabase handles the backend (database, auth, file storage in a private `documents` bucket).
