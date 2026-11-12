# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-12

### Security & Hardening
- **Sanitized Public Health Check**: Hardened `GET /healthz` to return a strictly sanitized `{ status: "ok", ready: boolean }` schema, redacting upstream LubeLogger server URLs (private IP/cluster DNS), backend version numbers, and internal connection error strings to prevent network topology disclosure to unauthenticated scanners.
- **Consolidated MCP Transport Method Guards**: Replaced disparate method handlers with a consolidated `app.all('/mcp')` guard that strictly accepts `POST` requests and rejects all other HTTP methods (`GET`, `DELETE`, `PUT`, `PATCH`, `HEAD`) with HTTP 405 Method Not Allowed and an `Allow: POST` header.
- **Attack Surface Pruning**: Pruned 6 unneeded static brand asset routes (`/logo.svg`, `/logo-symbol.svg`, `/logo.png`, `/logo-dark.png`, `/favicon.ico`, `/apple-touch-icon.png`) and removed the duplicate root metadata endpoint (`/.well-known/oauth-protected-resource`), keeping only the canonical RFC 9728 path `/.well-known/oauth-protected-resource/mcp`.
- **Inlined Consent Screen Branding**: Embedded the official dark-mode neural wheel lockup vector directly into `renderConsentHtml`, eliminating external HTTP image asset roundtrips and avoiding CSP cross-origin blocking during OAuth authorization.
- **MCP Transport Rate Limiting**: Added rate limiting middleware to `POST /mcp` (default: 120 requests/minute) backed by configurable environment variables `MCP_RATE_LIMIT_WINDOW_MS` and `MCP_RATE_LIMIT_MAX` to prevent transport denial-of-service and connection starvation.
- **Dynamic Client Capacity & LRU Eviction**: Implemented least-recently-used (LRU) capacity eviction in `FileTokenStore` when `MAX_REGISTERED_CLIENTS` (20) is exceeded. Stored client registrations now track `last_seen_at` timestamps updated on client retrieval and token operations. Eviction deletes stale clients and their associated access and refresh tokens, preventing client registration exhaustion DoS while preserving active sessions across restarts with debounced asynchronous persistence.

## [1.1.3] - 2026-11-12

### Fixed
- **Gemini Connector Brand Icon**: Replaced SVG data URI in `BRAND_ICON_DATA_URI` with a Base64-encoded PNG data URI (`docs/logo-symbol.png`), matching `actual-mcp`. Google Gemini's web client (`gemini.google.com`) strictly enforces Content Security Policy (blocking external image origins via `blocked:csp`) and does not render SVG data URIs in tool connector icon slots. Inlining the raster PNG directly into `serverInfo.icons` with `mimeType: 'image/png'` and sizes `['128x128', '512x512']` fixes the fallback droplet placeholder.
- **OAuth Discovery Logo URI**: Set default `logo_uri` to `${config.PUBLIC_URL}/logo-symbol.png` so OAuth metadata advertises the square brand symbol.

## [1.1.2] - 2026-11-12

### Changed
- **Pure API Key Authentication**: Completely removed the option to authenticate with username and password. Authorization is now 100% API-Key-first (`x-api-key`) with zero passwords collected, transmitted, or stored.
- **Simplified Consent Screen**: Removed the account/password tab panel, navigation toggles, and scripts on `/authorize`. The consent screen now focuses exclusively on the LubeLogger API Key input with direct settings deeplink and zero-password security badge.
- **Streamlined Setup Wizard**: Removed the Basic Auth (username/password) prompt from `scripts/setup-wizard.sh`.
- **Official Repository Brand Logo**: Replaced the legacy teardrop icon with the official LubeLogger MCP neural wheel lockup and symbol across all server endpoints (`/logo.svg`, `/logo-dark.svg`, `/logo-symbol.svg`, `/logo.png`, `/favicon.ico`, `/apple-touch-icon.png`) and MCP server declaration (`icons`). Copied `docs/` brand assets into runtime Docker image.

## [1.1.1] - 2026-11-12

### Fixed
- **Dynamic Client Registration Resilience**: Wrapped `persistToDisk()` in a resilient `try/catch` so dynamic OAuth registration (`POST /register`) never fails with 500 when disk persistence encounters permission restrictions (`EACCES`). Clients and tokens are retained in-memory safely.
- **Docker Volume Permissions**: Removed `USER node` in `Dockerfile` to match `actual-mcp` standards, preventing host bind-mount permission conflicts when `./data` is mounted to `/data`.
- **Diagnostic Logging**: Added explicit exception logging to `registerClient` to surface exact stack traces rather than generic 500 errors.
- **Setup Wizard Host Permissions**: Ensured `./data` directory has open permissions in `scripts/setup-wizard.sh`.

## [1.1.0] - 2026-11-12

### Added
- **API-Key-First Zero-Password Authentication**: Adopted the "Home Assistant Pattern" for LubeLogger authorization. Master account passwords are never collected, transmitted, or stored in plaintext or decodable text.
- **Branded Dark Theme Consent Screen**: Redesigned `/authorize` screen featuring the official `lubelogger MCP` logo (`logo-dark.svg`), zero-password security badge, and direct deeplinks to LubeLogger settings (`Settings ➔ Profile ➔ API Keys`).
- **Brand Asset Endpoint**: Added `/logo-dark.svg` endpoint to serve the official dark-mode neural wheel lockup vector directly.
- **Research & Technical Specifications**: Added `docs/spec-api-key-first-auth.md`, `docs/research-ha-mcp-auth.md`, and `docs/research-native-auth-vs-embedded-oauth.md`.

### Changed
- **Setup Wizard Streamlining**: Condensed `scripts/setup-wizard.sh` from 6 stages down to 5 by automating standard OAuth redirect URI configurations and eliminating redundant manual steps.
- **Documentation Updates**: Updated `README.md` and `GLOSSARY.md` to reflect the zero-password architecture and remove deprecated single-passphrase references.

## [1.0.0] - 2026-11-11

### Added
- Initial release of `lubelogger-mcp`.
- 15 Model Context Protocol (MCP) tools for LubeLogger (read tools, consolidated write facades, operational maintenance tools).
- In-process vehicle name resolution with fuzzy matching and suggestion envelopes.
- Embedded OAuth 2.1 authorization server with PKCE (`S256`) and RFC 7591 dynamic client registration.
- Streamable HTTP transport (`POST /mcp`) and health probe (`GET /healthz`).
- Interactive VPS setup wizard and Docker Compose configuration.
