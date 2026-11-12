# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
