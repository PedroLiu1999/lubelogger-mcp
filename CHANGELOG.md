# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
