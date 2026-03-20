# MinimaLog

A minimalist strength-training tracker built for lifters who want clean, focused workout logging with social features and progress analytics.

## Features

- **Workout Tracking** — Log exercises, sets, reps, and weight with real-time session timing
- **Personal Records** — Automatic PR detection for rep maxes and estimated 1RM (Epley & Brzycki formulas)
- **Progress Charts** — Visualize strength progression per exercise with filtering by name and muscle group
- **Social Feed** — Follow other lifters, share workouts, like and comment on posts
- **Pre-Session Metrics** — Track sleep quality, mood, and pre-workout supplement use
- **Unit Conversion** — Seamless kg/lb switching with user preference persistence
- **Mobile Ready** — iOS and Android deployment via Capacitor

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS
- **UI Components:** shadcn/ui (Radix primitives)
- **Backend:** Supabase (PostgreSQL, Auth, Real-time subscriptions)
- **Animations:** Framer Motion
- **Charts:** Recharts
- **Mobile:** Capacitor (iOS/Android)

## Security Architecture

- **Row-Level Security (RLS)** — Every database table enforces ownership checks at the Postgres level. Post visibility is scoped through follow relationships, and a dedicated `public_profiles` table separates public-facing data from private account details. No data leaves the database without passing an RLS policy.

- **Server-Side Security Functions** — 8 `SECURITY DEFINER` functions handle sensitive operations (feed aggregation, PR calculations, progress queries) server-side, keeping business logic out of the client and preventing self-notification abuse.

- **Input Validation** — All user-facing inputs are validated with Zod schemas before reaching the database — enforcing strict length bounds, alphanumeric restrictions, and type safety at the application boundary.

- **Authentication & Session Management** — Centralized `AuthContext` wraps Supabase Auth with automatic token refresh, per-page auth guards, and age verification (16+) at registration. No unauthenticated request reaches a protected resource.

- **Defense-in-Depth Key Management** — Only the publishable anon key is exposed client-side via `VITE_` prefix. The service role key stays server-side. Data protection is enforced by RLS policies, not key secrecy — so even a leaked anon key cannot bypass access controls.

## Local Development

### Prerequisites

- Node.js 18+
- npm
- A Supabase project

### Setup

```bash
# Install dependencies
npm install

# Create your environment file
cp .env.example .env
# Then fill in your Supabase credentials (see Environment Variables below)

# Start the dev server
npm run dev
```

The app runs at `http://localhost:8080`.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |

## Environment Variables

Create a `.env` file in the project root with:

```
VITE_SUPABASE_PROJECT_ID=your_project_id
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
VITE_SUPABASE_URL=https://your_project_id.supabase.co
```

These values come from your Supabase project dashboard under **Settings > API**.

> **Note:** The publishable (anon) key is safe to use client-side — it is scoped by Row-Level Security policies. Never expose your `service_role` key in client code.

## Mobile Deployment

The app supports native builds via Capacitor:

```bash
# Build the web app
npm run build

# Sync with native projects
npx cap sync

# Open in Xcode (iOS)
npx cap open ios

# Open in Android Studio
npx cap open android
```

## Project Structure

```
src/
  pages/          # Route-level page components
  components/     # Shared components (ui/ for shadcn primitives)
  lib/            # Utilities (auth, unit conversion, PR detection)
  hooks/          # Custom React hooks
  integrations/   # Supabase client and auto-generated types
supabase/
  migrations/     # Database migration SQL files
```

## License

All rights reserved.
