# 📱 Mobile app and API: local setup

The mobile app and the FastAPI backend run as two processes. The app has no
compiled-in server address: it reads `EXPO_PUBLIC_API_URL` at build time.

---

## One command (backend + tunnel + Expo + QR code)

```bash
python3 scripts/run_app.py
```

The script starts the API, opens a Cloudflare quick tunnel, starts Expo Metro
with `EXPO_PUBLIC_API_URL` pointing at the tunnel, and prints a QR code for Expo
Go. It never edits files in `mobile/`.

Windows shortcuts: double-click [`start.bat`](../start.bat) or run
`.\start.ps1`.

---

## Manual setup

### 1. Start the API

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" -r requirements-dev.txt

cd backend
cp .env.example .env      # set SECRET_KEY
cd ..
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger UI: http://localhost:8000/docs
- Health check: http://localhost:8000/

The schema is migrated once at startup. Existing SQLite files from the old
bot-only schema are upgraded in place (email/password columns added, the legacy
`wallets` table archived as `wallets_archive`, indexes created). Set
`DATABASE_URL` to use PostgreSQL (Supabase) instead; see the README setup
section and `scripts/migrate_sqlite_to_postgres.py` for copying existing data.

### 2. Start the mobile app

Use Yarn Classic 1.22.22, pinned by `mobile/package.json`. On machines with
Corepack installed, run `corepack enable yarn` once to expose both `yarn` and
`yarnpkg`. Expo CLI selects Yarn because this project has `yarn.lock`; without
the shims, `expo install --fix` fails with `spawn yarnpkg ENOENT`. Do not create
an additional npm lockfile to work around the missing executable.

```bash
cd mobile
cp .env.example .env
# Physical device: use your machine's LAN IP, not localhost
# EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
# Google sign-in (Android native build only):
# EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
yarn install
npx expo start
```

After updating dependencies, run `npx expo install --check`, `npx expo-doctor`,
and `npx tsc --noEmit`. To align dependencies with the installed Expo SDK, use
`npx expo install --fix --yarn`, not an unbounded upgrade to another SDK.

Test options:

- **Physical device**: install Expo Go and scan the QR code. Email/password
  works here; Google controls stay hidden because the native module is absent.
- **Web**: press `w`.
- **Android emulator**: press `a`.
- **iOS simulator**: press `i` (macOS only).

### 2a. Google sign-in on Android

Google needs a development build (or an APK), not Expo Go.

1. In Google Cloud, create one **Web** OAuth client and one **Android** client
   for package `com.financeapp.mobile` with the SHA-1 of the signing certificate
   you actually build with. EAS preview/debug builds use a different keystore
   from Play App Signing, so register every fingerprint you ship.
2. Set the same Web client ID in the backend `GOOGLE_WEB_CLIENT_ID` and in the
   mobile build `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. For a local build put it in
   `mobile/.env`; for EAS put it in the EAS environment used by that profile
   (`eas env:create`), not in git.
3. Replace the placeholder `iosUrlScheme` in `mobile/app.json` with the real
   reversed iOS client ID before any iOS work, and set an iOS bundle identifier
   when iOS ships. Android ignores that value, but the current config plugin
   refuses to prebuild without it.
4. Build and install:

```bash
npx eas-cli build --platform android --profile preview
# or, for a local development client:
npx expo prebuild --platform android
yarn android
```

The `development` EAS profile inherits the API URL in `eas.json`, which points at
the current deployed API. Override `EXPO_PUBLIC_API_URL` for that profile before
testing against a local backend, so a dev build never writes into production
data.

5. Sign in with Google, then check the existing password account flow still
   works. Linking Google is only offered in Settings for accounts that have a
   password and the same verified email.

Do not commit client secrets or signing keys. The Web client ID is public and
safe to ship; a Google client secret is not used by this flow.

### 2b. EAS cloud build upload boundaries

Run EAS commands from `mobile/`, where `package.json`, `app.json`, and `eas.json`
live. The repository-root [`.easignore`](../.easignore) controls the upload and
replaces all `.gitignore` files for this purpose. Keep it at the repository root,
not inside `mobile/`. No source files need to be deleted for a clean build.

| Files | Upload to EAS | Purpose |
| --- | --- | --- |
| `mobile/app/`, `components/`, `services/`, `utils/` | Yes | Application source bundled by Metro |
| `mobile/assets/` | Yes | Referenced fonts/images become runtime assets |
| `mobile/types/`, `tsconfig.json`, `babel.config.js` | Yes | Type and compiler configuration, not raw APK folders |
| `mobile/package.json`, `yarn.lock`, `app.json`, `eas.json` | Yes | Dependency installation, Expo configuration, build profiles |
| Backend, bot, Python environments, repository docs/plans/CI | No | Run separately; not Android runtime dependencies |
| `mobile/tests/`, dependencies, caches, build outputs | No | Test locally/CI; EAS installs dependencies itself |
| `mobile/android/`, `mobile/ios/` | No | Generated on EAS from Expo configuration and config plugins |
| `.env*`, databases, backups, signing keys, package-manager auth files | No | Supply required build values/credentials through EAS |

**The upload archive is not the APK.** EAS consumes source/configuration and
compiles the native app, JavaScript/Hermes bundle, referenced assets, and required
native dependencies. It does not place every uploaded folder into the APK as a
raw directory. Ignore rules reduce upload scope; they are not a substitute for
checking imports and keeping secrets out of application code.

This project uses Continuous Native Generation. Local native-project edits do
not reach cloud builds. Put durable native changes in `app.json` or config
plugins. Existing local `android/` files are kept on disk but excluded from the
upload, so stale generated projects cannot omit newly added native modules.

Before building:

1. Configure `EXPO_PUBLIC_API_URL` and, for Google sign-in,
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the EAS environment selected by the build
   profile. `development` and `preview` already set the API URL in `eas.json`;
   `production` requires its API URL from the EAS environment. Local `.env` files
   are not uploaded. Never put backend secrets in `EXPO_PUBLIC_*` variables.
2. Use the `preview` profile for an installable APK. `development` produces a
   development-client APK; `production` currently produces an AAB for Play Store.
3. From a development machine, optionally inspect the archive before submitting:

   ```bash
   cd mobile
   npx eas-cli build:inspect --platform android --profile preview --stage archive --output ../eas-archive-inspect
   ```

   This inspects the upload stage, not a native APK build. The inspection output
   is outside `mobile/` and excluded by the upload policy. Do not commit it.
4. Submit the cloud build from `mobile/`:

   ```bash
   npx eas-cli build --platform android --profile preview
   ```

The root allowlist assumes the app has no imports from other repository
packages. If it gains shared workspace packages, extend `.easignore` to include
them. Likewise, deliberately include new build hooks, patches, or configuration
files if the build starts depending on them. A private dependency registry would
need EAS-managed authentication instead of uploading a local `.npmrc` token.

Upload-policy verification retained 79 files, approximately 1.20 MiB before
compression, with every local source import and referenced asset present. An
Android JavaScript/Hermes export and Expo configuration resolution also passed
from a filtered input snapshot using the existing installed dependencies. This
checks the ignore policy and bundle inputs, not EAS authentication, dependency
installation, native prebuild, signing, or an actual APK/cloud build.

### 2c. Android launcher icon

`mobile/app.json` explicitly references the existing branded PNG assets under
`mobile/assets/images/`: the legacy icon, adaptive foreground, and monochrome
foreground. The adaptive background is ink (`#171A16`). These assets were
previously only present on the separate launcher-icon branch; they are now
included with the current mobile features and retained by `.easignore`.

A filtered temporary `expo prebuild --platform android --no-install` generated
launcher resources for all five Android densities, adaptive/monochrome XML, and
manifest icon references. This generated resources only, not an APK. An already
installed APK cannot get a new launcher icon from a JavaScript update. Build an
updated APK on EAS from the branch containing these files, install it, and verify
the normal and themed icon in the device launcher. Do not uninstall just to clear
a cached icon unless local-only state has been backed up.

### 3. Auth flow

1. Register or log in. The API returns an access token (30 min) and a refresh
   token (30 days).
2. Tokens are stored in SecureStore on native builds. On web they are kept in
   memory only, so a reload requires logging in again.
3. Any `401` triggers one refresh attempt; if that fails the session is cleared
   and the router returns to the login screen.
