# Spec: Public Endpoint Security Hardening and Attack Surface Pruning

**Status:** Ready for Review  
**Triage Label:** `ready-for-agent`  
**Date:** 2026-11-12  
**Domain Vocabulary:** See [GLOSSARY.md](file:///home/peterliu/lublogger-mcp/GLOSSARY.md) and [AGENTS.md](file:///home/peterliu/lublogger-mcp/AGENTS.md)  

---

## Problem Statement

When exposing `lubelogger-mcp` to remote AI assistants (e.g., Claude Desktop, Cursor, ChatGPT) over the public internet, the application's attack surface contains unnecessary endpoints, redundant HTTP verb handlers, and potential information disclosure vectors:

1. **Brand Asset Route Bloat:** The application defines eight distinct HTTP endpoints for serving static brand assets and logos (`/logo.svg`, `/logo-dark.svg`, `/logo-symbol.svg`, `/logo.png`, `/logo-dark.png`, `/logo-symbol.png`, `/favicon.ico`, `/apple-touch-icon.png`). These take up significant route handler code and expose unneeded public paths.
2. **Legacy Method Rejection Endpoints:** Dedicated route handlers exist for `GET /mcp` and `DELETE /mcp` returning 405 Method Not Allowed (legacy holdovers from Server-Sent Events transports), while other invalid HTTP verbs are handled inconsistently.
3. **Duplicate Metadata Endpoints:** The server mounts two separate endpoints for OAuth protected resource metadata (`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`), creating redundancy.
4. **Information Disclosure via Health Checks:** The unauthenticated `GET /healthz` endpoint publicly exposes the internal LubeLogger server URL (private IP, port, or cluster hostname) and backend software version numbers, revealing internal network topology to unauthorized scanners.
5. **Missing Transport Rate Limiting:** The active `POST /mcp` transport endpoint lacks request rate limiting, leaving the server vulnerable to transport connection floods from authenticated or misconfigured clients.
6. **Registration Denial-of-Service Risk:** Dynamic client registration (`POST /register`) enforces a hard limit of 20 clients without an automated LRU or TTL eviction mechanism, allowing attackers to exhaust available client registration slots.

---

## Solution

Harden and prune the public HTTP surface of `lubelogger-mcp` by removing non-essential endpoints, unifying HTTP verb guards, sanitizing unauthenticated health responses, and applying defensive rate limiting:

1. **Prune Brand Asset Endpoints:** Remove redundant standalone asset routes and serve required public assets (consent screen logo and OAuth metadata logo) through static file resolution or inlined SVGs, eliminating extraneous public endpoints.
2. **Consolidate MCP Transport Method Guards:** Replace discrete `GET /mcp` and `DELETE /mcp` handlers with a unified route guard on `/mcp` that only accepts `POST` (the only valid verb for Streamable HTTP JSON-RPC) and rejects all other HTTP methods with 405 Method Not Allowed.
3. **Remove Redundant Metadata Route:** Prune the root `/.well-known/oauth-protected-resource` endpoint, retaining only the RFC 9728 canonical path `/.well-known/oauth-protected-resource/mcp`.
4. **Sanitize Public Health Check:** Redact internal network URLs and backend version strings from `GET /healthz`. The response will only communicate health state (e.g., `{ status: "ok", ready: true }`).
5. **Rate Limit MCP Transport:** Mount an explicit rate limiter on `POST /mcp` to defend against transport session flooding.
6. **Dynamic Client Eviction Policy:** Implement LRU or TTL eviction for dynamically registered OAuth clients in the token store so registration limits cannot be permanently exhausted.

---

## User Stories

1. As a security-conscious administrator, I want unneeded public endpoints removed from `lubelogger-mcp`, so that the server's attack surface is minimized.
2. As a security-conscious administrator, I want unauthenticated requests to `/healthz` to never reveal internal network IPs, hostnames, or backend software versions, so that internal infrastructure details remain confidential.
3. As an operator running `lubelogger-mcp` behind a reverse proxy, I want monitoring probes to receive a lightweight `{ status: "ok", ready: true }` health response, so that liveness checks succeed without information leakage.
4. As an MCP client connecting via Streamable HTTP, I want any non-`POST` request to `/mcp` to return an explicit HTTP 405 Method Not Allowed with an `Allow: POST` header, so that transport protocol requirements are clearly communicated.
5. As an MCP client developer, I want all legacy dummy routes (`DELETE /mcp`, `GET /mcp`) cleaned up into a unified route guard, so that route handling is uniform and predictable.
6. As an OAuth 2.1 client discovering protected resource metadata, I want the canonical RFC 9728 endpoint `/.well-known/oauth-protected-resource/mcp` to remain fully functional, so that automatic authentication discovery continues to work.
7. As a user viewing the OAuth consent screen, I want the consent page to display the dark-mode LubeLogger MCP brand logo cleanly, without requiring eight separate asset endpoints to be mounted.
8. As a client inspecting OAuth server metadata, I want the `logo_uri` to resolve to a valid brand icon, without exposing unreferenced icon routes.
9. As a vehicle owner using an AI assistant, I want `POST /mcp` to be protected by rate limiting, so that malfunctioning scripts or connection loops cannot exhaust server resources.
10. As an automated MCP client (such as Claude Desktop), I want to register dynamically via RFC 7591 without failing due to permanent slot exhaustion from inactive clients.
11. As an administrator reviewing server logs, I want all remaining public endpoints to maintain strict host header validation and anti-framing security headers, so that DNS rebinding and clickjacking protections remain intact.
12. As a developer maintaining `lubelogger-mcp`, I want existing end-to-end tool execution and OAuth flows to remain completely unbroken by the endpoint pruning, so that zero regression is introduced.

---

## Implementation Decisions

### 1. Brand Asset Endpoint Pruning
- Eliminate standalone routes for `/logo.svg`, `/logo-symbol.svg`, `/logo.png`, `/logo-dark.png`, `/favicon.ico`, and `/apple-touch-icon.png`.
- Retain only the brand assets strictly necessary for OAuth client metadata discovery and consent UI rendering (`logo-dark.svg` and `logo-symbol.png`), served either statically or via a single consolidated asset handler.
- Inline the dark logo SVG or serve it from `docs/` directly to ensure zero external network calls during consent screen rendering.

### 2. MCP Transport Method Consolidation
- Remove separate `app.get('/mcp')` and `app.delete('/mcp')` route handlers.
- Implement a unified method filter on the `/mcp` path:
  - If `req.method === 'POST'`, allow request to proceed through `bearerAuth` to the Streamable HTTP transport.
  - For all other methods (`GET`, `DELETE`, `PUT`, `PATCH`, `HEAD`), respond immediately with HTTP 405 Method Not Allowed and an `Allow: POST` header.

### 3. Protected Resource Metadata Simplification
- Unmount `/.well-known/oauth-protected-resource`.
- Keep `/.well-known/oauth-protected-resource/mcp` as the single canonical RFC 9728 discovery endpoint matching `config.PUBLIC_URL + '/mcp'`.

### 4. Health Check Information Redaction
- Modify the `GET /healthz` endpoint contract:
  - Strip `serverUrl` (which leaks internal LubeLogger IPs/ports).
  - Strip `serverVersion` (which leaks software patch levels).
  - Strip raw internal connection error strings.
  - Return exclusively sanitized indicators: `{ status: "ok", ready: boolean }`.

### 5. Transport Endpoint Rate Limiting
- Add rate limiting middleware specifically targeting `POST /mcp` (e.g., 120 requests per minute window) to mitigate denial-of-service transport attacks.

### 6. Dynamic Client Eviction in Token Store
- Introduce LRU or last-seen timestamps to stored OAuth dynamic client registrations.
- When `MAX_REGISTERED_CLIENTS` is reached and a new dynamic registration request is received, automatically evict the least recently used or oldest unregistered client instead of rejecting the request with an unrecoverable error.

---

## Testing Decisions

### Seam Architecture
- **Highest Seam (Supertest HTTP Integration)**: Test exclusively through the top-level application HTTP seam using `supertest` against the Express application returned by `createApp(options)`.
- This ensures tests verify true end-to-end HTTP behavior: request routing, middleware ordering, header emission, status codes, and body serialization.

### External Behavior Verification
- Assert that `GET /healthz` returns HTTP 200 with `status` and `ready`, and assert that the response JSON does NOT contain `serverUrl` or `serverVersion`.
- Assert that `GET /mcp`, `DELETE /mcp`, `PUT /mcp`, and `PATCH /mcp` all return HTTP 405 Method Not Allowed with an `Allow: POST` header.
- Assert that pruned brand asset routes return HTTP 404 Not Found, while the canonical logo assets required by OAuth metadata continue to return HTTP 200 with appropriate image MIME types.
- Assert that `POST /mcp` enforces rate limiting when request thresholds are exceeded.
- Assert that registering a 21st dynamic client succeeds by evicting stale registrations rather than throwing a registration error.

### Prior Art
- Existing test suites: `tests/app.test.ts` and `tests/oauth.test.ts`.

---

## Out of Scope

- Modifying LubeLogger vehicle management tool facades (`manage_vehicles`, `manage_records`, `manage_reminders`, `manage_plans`, `manage_supplies`).
- Switching from the Embedded OAuth 2.1 Server to external cloud identity providers (e.g., Clerk, Auth0).
- Rewriting the Streamable HTTP transport implementation in the MCP SDK.

---

## Further Notes

- All changes maintain strict adherence to OAuth 2.1 PKCE (`S256`), RFC 7591 Dynamic Client Registration, and RFC 9728 Protected Resource Metadata.
