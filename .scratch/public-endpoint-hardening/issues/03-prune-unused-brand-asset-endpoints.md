# 03: Prune Unused Brand Asset Endpoints

**What to build:** Pruned brand asset delivery that eliminates redundant standalone image endpoints (`/logo.svg`, `/logo-symbol.svg`, `/logo.png`, `/logo-dark.png`, `/favicon.ico`, `/apple-touch-icon.png`), while keeping only the assets required by the OAuth consent interface (`/logo-dark.svg`) and client metadata discovery (`/logo-symbol.png`).

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] Redundant asset routes (`/logo.svg`, `/logo-symbol.svg`, `/logo.png`, `/logo-dark.png`, `/favicon.ico`, `/apple-touch-icon.png`) are removed and return HTTP 404
- [x] Essential brand assets (`/logo-dark.svg` and `/logo-symbol.png`) remain accessible with valid `Content-Type` headers
- [x] The OAuth 2.1 `/authorize` consent screen continues to render the official dark-mode brand logo cleanly
- [x] OAuth server and protected resource metadata discovery continue to provide valid `logo_uri` links
