# Shopping List

An offline-first, installable Progressive Web App (PWA) for managing shared shopping lists. Built with SvelteKit, Dexie (IndexedDB), and an AWS serverless backend (DynamoDB + Lambda), with infrastructure defined in Terraform.

## Features

- **Offline-First**: Works without internet. All data is stored locally and syncs when connection returns.
- **Installable PWA**: Add to your home screen on iOS, Android, and desktop for a native app experience.
- **Shared Lists**: Collaborate with family members via Google Sheets backend.
- **Smart Organization**: Group items by store or category with drag-and-drop reordering.
- **Shopping Mode**: Clean, focused view for checking off items while shopping.
- **Suggestions**: Frequency-based suggestions from your shopping history.
- **History Tracking**: View past shopping trips and frequently bought items.
- **Export**: Share lists via text, email, or messaging apps.
- **Dark Mode**: Automatic or manual theme switching.

## Tech Stack

- **Frontend**: SvelteKit 5, TypeScript, Tailwind CSS v4
- **Database**: Dexie (IndexedDB wrapper) for local storage; AWS DynamoDB server-side
- **Sync**: AWS Lambda Function URL (Node.js) over CORS, replacing the former Google Apps Script API
- **Infrastructure**: Terraform (S3-native state locking), deployed via GitHub Actions + AWS OIDC
- **Auth**: shared API key or Google sign-in (see SECURITY.md)
- **PWA**: vite-plugin-pwa (generateSW strategy) with Workbox
- **Icons**: Lucide Svelte
- **Build**: Vite 8 with static adapter
- **Testing**: Vitest with fake-indexeddb

## Development Setup

### Prerequisites

- Node.js 24+ and npm
- Google account (for Apps Script backend)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd shoppinglist-web

# Install dependencies
npm install

# Start development server
npm run dev
```

The dev server will start at `http://localhost:5173` with hot reload and PWA dev mode enabled.

## Build and Deployment

### Production Build

```bash
# Create optimized production build
npm run build

# Preview the production build locally
npm run preview
```

The build output is written to the `build/` directory as static files, ready for deployment to any static hosting service.

### Deployment Options

#### GitHub Pages (Recommended)

1. Push this repository to GitHub
2. Go to **Settings** → **Pages** → set **Source** to **GitHub Actions**
3. Go to **Settings** → **Secrets and variables** → **Actions** and add:
   - Variable `PUBLIC_API_BASE_URL` — the Lambda Function URL (Terraform output `function_url`)
   - Variable `PUBLIC_GOOGLE_CLIENT_ID` — optional; set to enable Google sign-in
   - Secret `API_KEY` — shared API key (must match Terraform `api_key`); ignored when Google auth is enabled
   (The Terraform workflow also needs `AWS_ROLE_ARN`, `AWS_REGION`, `TF_STATE_BUCKET`, `ALLOWED_ORIGINS` — see `.github/workflows/terraform.yml`.)
4. Push to `main` (or trigger workflow manually) — the Actions workflow builds and deploys automatically

#### Netlify / Vercel

1. Connect your GitHub repository
2. Set build command: `npm run build`
3. Set publish directory: `build`

#### Static Hosting (Apache/Nginx)

Copy the contents of the `build/` directory to your web server's document root. Ensure `.webmanifest` and service worker files are served with correct MIME types.

## Environment Variables

### Local Development

Copy `.env.example` to `.env` and fill in your API base URL:

```bash
cp .env.example .env
```

```env
# Required — the Lambda Function URL (Terraform output `function_url`)
PUBLIC_API_BASE_URL=https://YOUR_FUNCTION_URL.lambda-url.<region>.on.aws/

# Auth — choose ONE:
PUBLIC_API_KEY=your-shared-api-key      # API-key mode (must match Terraform api_key)
PUBLIC_GOOGLE_CLIENT_ID=                 # Google mode (set to your OAuth Web client ID)

# Optional — these fall back to defaults
PUBLIC_APP_NAME=Shopping List
PUBLIC_APP_VERSION=1.0.0
```

> `.env` is **gitignored** — never commit it. It's only used when running `npm run dev` or `npm run build` locally.

### Production (GitHub Pages)

For CI deployment, values are injected from **GitHub Actions variables/secrets** (see [GitHub Pages deployment](#github-pages-recommended) above). Do not create a `.env` file in the repo for production — the build reads `vars.PUBLIC_API_BASE_URL`, `vars.PUBLIC_GOOGLE_CLIENT_ID`, and `secrets.API_KEY` in the Actions workflow.

## Security

Authentication is a shared API key or Google sign-in with an email allowlist. See `SECURITY.md` for the full threat model and configuration.

## AWS Backend (DynamoDB + Lambda)

The backend is an AWS Lambda (Node.js) fronted by a Lambda Function URL, storing data in a DynamoDB single table. All infrastructure is defined in Terraform.

### Setup outline

1. **Bootstrap** (once): `cd terraform/bootstrap && terraform apply` — creates the S3 state bucket, GitHub OIDC provider, and CI role. See `terraform/bootstrap/README.md`.
2. **Main stack**: `cd terraform && terraform init -backend-config=... && terraform apply` — creates DynamoDB, the Lambda, and the Function URL. See `terraform/README.md`.
3. **Migrate data** (once): run `lambda/scripts/migrate.mjs` to copy existing data from the old Apps Script backend into DynamoDB. See `lambda/README.md`.
4. **Wire the frontend**: set `PUBLIC_API_BASE_URL` (the `function_url` output) as a GitHub Actions variable.

CI (`.github/workflows/terraform.yml`) plans on PRs and applies on `main` via GitHub OIDC (no long-lived AWS keys). The former `apps-script/` backend is retained for reference only.

## PWA Install Instructions

### iOS (Safari)

1. Open the app in Safari
2. Tap the Share button
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right

### Android (Chrome)

1. Open the app in Chrome
2. Tap the menu (three dots)
3. Tap "Add to Home screen" or "Install app"
4. Follow the prompts

### Desktop (Chrome/Edge)

1. Open the app in Chrome or Edge
2. Look for the install icon in the address bar (or menu)
3. Click "Install Shopping List"

## Architecture

```
Server (AWS Lambda Function URL + DynamoDB)
    ↓ raw JSON
normalizeArray()  ←── single ingestion boundary
    ↓ canonical TypeScript types
IndexedDB (Dexie)
    ↓ trusted, typed data
Queries / Operations ←── serialize() strips reactive proxies on writes
    ↓
Svelte stores + SyncController
    ↓ reactive state
UI Components
```

Key boundaries:
- **Normalization** (`db/normalize.ts`) — coerces server data to match TypeScript interfaces (empty strings → null, string booleans → boolean, etc.)
- **Serialization** (`db/serialize.ts`) — strips Svelte 5 reactive proxies before IndexedDB writes
- **SyncController** (`components/SyncController.svelte`) — client-only component managing sync lifecycle, avoiding SSR issues

## Offline Behavior

- The app caches its shell and assets on first visit
- All shopping list data is stored in IndexedDB (local browser storage)
- Changes made offline are queued and synced automatically when online
- An offline page is shown if you navigate to an uncached page while offline

## Project Structure

```
shoppinglist-web/
├── apps-script/          # Legacy Google Apps Script backend (retained for reference)
├── lambda/               # AWS Lambda sync backend (TypeScript) + migration script
├── terraform/            # Infrastructure as Code (bootstrap + main stack)
├── scripts/             # Build utilities (icon generation)
├── src/
│   ├── app.html         # HTML template with PWA meta tags
│   ├── app.css          # Global styles (Tailwind v4) and CSS variables
│   ├── lib/
│   │   ├── components/  # Svelte UI components
│   │   ├── config/      # Environment and app configuration
│   │   ├── db/          # Dexie database layer
│   │   │   ├── database.ts   # Schema definition
│   │   │   ├── normalize.ts  # Server data normalization (ingestion boundary)
│   │   │   ├── serialize.ts  # Proxy stripping for IndexedDB writes
│   │   │   ├── operations.ts # CRUD operations
│   │   │   ├── queries.ts    # Read queries
│   │   │   ├── changes.ts    # Change tracking
│   │   │   └── utils.ts      # Helpers (UUID, timestamps)
│   │   ├── stores/      # Svelte 5 runes-based stores (.svelte.ts)
│   │   ├── sync/        # Sync engine, scheduler, API client
│   │   ├── view-modes/  # List grouping and projection logic
│   │   ├── shopping/    # Shopping mode progression logic
│   │   ├── export/      # Plain text export engine
│   │   ├── suggestions/ # Item suggestion algorithm
│   │   ├── drag-drop/   # Drag and drop ordering
│   │   └── utils/       # Helper utilities
│   ├── tests/           # Vitest unit tests
│   └── routes/          # SvelteKit routes
│       ├── +layout.svelte   # App shell, SyncController
│       ├── +page.svelte     # Main list builder
│       ├── shopping/        # Shopping mode
│       ├── history/         # Historical lists
│       └── settings/        # App settings
├── static/              # Static assets (icons, manifest)
├── .github/workflows/   # CI/CD (GitHub Pages deployment)
├── SECURITY.md          # Authentication model and threat assessment
├── svelte.config.js     # SvelteKit configuration (static adapter)
├── tailwind.config.js   # Tailwind CSS configuration
├── vitest.config.ts     # Test configuration
├── vite.config.ts       # Vite and PWA configuration
└── package.json         # Dependencies and scripts
```

## PWA Checklist

- [x] Web App Manifest with required fields
- [x] Service worker with precaching
- [x] Offline fallback page
- [x] Icons (192x192, 512x512, SVG, Apple touch icon, favicon)
- [x] Theme color meta tags (light/dark mode support)
- [x] Apple mobile web app meta tags
- [x] Safe area insets for notched devices
- [x] Touch targets >= 44px
- [x] Install prompt handling
- [x] Works offline after first load

## Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

Tests use Vitest with fake-indexeddb to validate the database layer, normalization, and serialization boundaries.

## License

MIT
