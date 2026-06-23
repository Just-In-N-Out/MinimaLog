# MinimaLog

A production iOS workout journal with offline-first architecture, client-side encryption, and real-time social features. Built with React, TypeScript, and Capacitor -- live at [minimalog.fit](https://minimalog.fit).

## Features

- **Offline-First Sync Engine** -- All actions work without connectivity. An IndexedDB operation queue persists mutations locally, then syncs sequentially with Supabase when the network returns. Temp IDs are resolved to real UUIDs during sync with last-write-wins conflict resolution.

- **AES-256-GCM Encryption** -- Sensitive data (session tokens, operation payloads, user emails) is encrypted at rest in IndexedDB using Web Crypto API. Keys are derived via PBKDF2 (100k iterations) from the user's ID, enabling offline decryption without key storage.

- **Social Feed** -- Follow other users, share workout posts with images, view a personalized feed. Privacy controls, post creation with image uploads, and profile discovery.

- **AI Workout Tips** -- Google Gemini-powered workout suggestions and tips delivered via Supabase Edge Functions.

- **In-App Subscriptions** -- RevenueCat integration with tiered pricing (weekly/monthly/yearly), native iOS paywall, feature gating, and server-side webhook validation.

- **PR Detection** -- Automatic personal record tracking with 1RM estimation across multiple calculation formulas.

- **Native iOS** -- Capacitor bridge for haptic feedback, filesystem caching, Apple Sign-In, and network detection. Optimized for WKWebView with data protection.

## Architecture

### Offline Data Flow

```
User action
  |
  v
Optimistic UI update (React.startTransition)
  |
  v
Queue operation in IndexedDB (encrypted)
  |
  v
Online? --> Sync engine processes queue sequentially
         --> Resolve temp IDs to real UUIDs
         --> Supabase mutation
         --> Update local cache with server response
```

### Key Systems

| System | Files | Purpose |
|--------|-------|---------|
| Sync Engine | `src/lib/sync/syncEngine.ts` | Sequential queue processing, temp ID resolution, conflict handling |
| Operation Queue | `src/lib/db/operationQueue.ts` | Append-only encrypted mutation queue |
| IndexedDB Layer | `src/lib/db/indexedDB.ts` | 9 object stores for offline data |
| Encryption | `src/lib/crypto.ts` | AES-GCM encrypt/decrypt, PBKDF2 key derivation |
| Encrypted Storage | `src/lib/db/encryptedStorage.ts` | Transparent encryption wrapper for IndexedDB |
| Session Management | `src/lib/session.ts` | Three-layer session cache with encryption fallbacks |
| Network Detection | `src/lib/network.ts` | Capacitor + navigator.onLine with debounced state |
| Image Caching | `src/lib/cache/` | Multi-layer blob caching (avatars, exercise images, filesystem) |

### Caching Strategy

- **TanStack Query**: Server state with `staleTime: 60s`, `gcTime: 5min`, `refetchOnReconnect: true`
- **IndexedDB**: Denormalized workout documents for offline reads
- **Filesystem Cache**: Capacitor filesystem for persistent image blob storage
- **Session Cache**: Three-layer fallback (JSON parse -> decrypt -> raw string -> emergency ID)

## Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion, GSAP |
| **State** | Zustand (client state), TanStack Query (server state), React Hook Form + Zod |
| **Backend** | Supabase (Auth, PostgreSQL, Storage, Edge Functions, Realtime) |
| **Native** | Capacitor 7 (iOS/Android), Apple Sign-In, Haptics, Filesystem, Network |
| **Payments** | RevenueCat (subscriptions, native paywall UI) |
| **AI** | Google Gemini via Supabase Edge Functions |
| **Data** | IndexedDB (idb), Web Crypto API, PBKDF2, AES-256-GCM |
| **Build** | Terser (2-pass), manual chunk splitting, lazy route loading |

## Project Structure

```
src/
  components/        # 40+ UI components (shadcn/ui + custom glass morphism)
  pages/             # 20+ lazy-loaded route screens
  hooks/             # Custom hooks (subscriptions, profiles, feeds)
  lib/
    sync/            # Offline sync engine
    db/              # IndexedDB schema + encrypted storage
    cache/           # Multi-layer image caching
    crypto.ts        # AES-256-GCM encryption utilities
    session.ts       # Encrypted session management
    network.ts       # Network state detection
    revenuecat.ts    # Subscription SDK wrapper
  types/             # TypeScript definitions
supabase/
  migrations/        # 78 SQL migrations (schema evolution)
  functions/         # Edge Functions (AI tips, webhooks, cleanup)
ios/                 # Capacitor iOS project (Xcode)
android/             # Capacitor Android project
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- A Supabase project (see `supabase/migrations/` for schema)
- Xcode 15+ (for iOS builds)

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in your Supabase URL, anon key, Gemini API key, and RevenueCat key

# Start development server
npm run dev

# Sync and open iOS project
npm run ios:sync
npm run ios:open
```

### Build

```bash
# Production build (Terser minification, console stripping, chunk splitting)
npm run build

# Development build (sourcemaps, console preserved)
npm run build:dev
```

## Database

78 SQL migrations in `supabase/migrations/` covering:

- User authentication and profiles
- Workout, exercise, and set schemas with RLS policies
- Social feed (posts, follows, privacy)
- PR tracking and progress history
- Template system
- Subscription tiers and usage tracking
- Workout count management with triggers

## License

All rights reserved.
