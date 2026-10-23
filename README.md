# BuildIt

AI DIY project planner: show the app a photo or describe what you want to make, and
get a complete buildable plan — dimensioned blueprint, materials/cut lists, tools,
and step-by-step instructions.

## Stack

- Next.js 16 (App Router) + TypeScript strict
- Tailwind CSS v4 + shadcn/ui
- Supabase (Postgres + Auth + Storage)
- OpenAI for plan generation (server-side only, via `lib/ai/`)
- Zod for all validation
- Stripe for subscriptions (Milestone 6)

## Setup

1. **Install deps**

   ```bash
   npm install
   ```

2. **Create a Supabase project** (free tier is fine) at https://supabase.com

3. **Configure env**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Supabase dashboard → Project Settings → API). Other vars can stay empty until
   their milestone.

4. **Apply the database schema**

   Either run the migration through the Supabase SQL editor
   (`supabase/migrations/0001_init.sql`), or link the CLI:

   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```

5. **Auth redirects** — in Supabase → Authentication → URL Configuration:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/auth/callback` and
     `http://localhost:3000/auth/confirm`
   - For Google sign-in, enable the Google provider (Authentication → Providers)
     with OAuth credentials from Google Cloud Console.

6. **Run**

   ```bash
   npm run dev
   ```

   App: http://localhost:3000

## Repo layout

```
app/            routes (App Router)
components/     shared UI; components/ui = shadcn
lib/            env, supabase clients, plan/blueprint/ai modules
  ai/prompts/   versioned AI prompts (plan.v1.ts provided by handoff)
supabase/migrations/  SQL migrations (RLS enabled on every table)
```

## Notes

- All AI calls happen server-side; never from the client.
- All plan dimensions are stored internally in millimeters.
- See `DECISIONS.md` for architecture choices and open questions.
