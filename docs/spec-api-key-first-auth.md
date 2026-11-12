# Spec: LubeLogger MCP Option 1 — API-Key-First Branded Authentication (Zero Decodable Passwords)

**Status:** Ready for Review  
**Triage Label:** `ready-for-agent`  
**Date:** 2026-11-12  
**Domain Vocabulary:** See [GLOSSARY.md](file:///home/peterliu/lublogger-mcp/GLOSSARY.md) and [AGENTS.md](file:///home/peterliu/lublogger-mcp/AGENTS.md)  

---

## Problem Statement

When connecting an AI assistant (such as Claude Desktop, Cursor, or ChatGPT) to `lubelogger-mcp` via Streamable HTTP and the Embedded OAuth 2.1 Server, users are presented with an authorization consent screen. 

Currently, users may enter their LubeLogger account username and password. Because LubeLogger's upstream REST API requires credentials for every downstream request, `lubelogger-mcp` currently encrypts the user's password using two-way symmetric AES-256-GCM encryption in its token store. However, symmetric encryption is fundamentally *decodable*: anyone with access to the host's encryption key and token store can decrypt the user's master account password back into plaintext. Users want to authorize AI assistants without exposing, transmitting, or storing their primary account password in plain or decodable text, while still having an intuitive, branded login experience that looks and feels like their native LubeLogger instance (similar to Home Assistant's authentication flow).

---

## Solution

Transform `lubelogger-mcp`'s authorization screen into an **API-Key-First Branded Authentication** flow (the "Home Assistant Pattern") with zero decodable password storage:

1. **Native LubeLogger UI Styling:** Re-theme the `/authorize` consent page to match LubeLogger's native web dashboard styling, including dark-mode palette, typography, visual hierarchy, badge styling, and the official **LubeLogger MCP logo** (`docs/logo-dark.svg`).
2. **API-Key-First Primary Flow:** Establish the LubeLogger **API Key** as the primary, default credential mechanism. The UI provides direct visual guidance and deeplinks explaining how to generate an API key in LubeLogger under *Settings ➔ Profile ➔ API Keys*.
3. **Zero Plaintext or Decodable Password Storage:** 
   - When an API key is provided, the master account password is never collected, transmitted, or stored anywhere.
   - API keys are revocable capability tokens: if compromised or no longer needed, the user can regenerate or delete them in LubeLogger at any time without compromising their master password, email, or web dashboard login.
4. **Immediate Verification & Secure Storage:** Validate the API key immediately against LubeLogger's `/api/vehicles` endpoint during authorization before issuing any authorization code. Store only the encrypted API key with AES-256-GCM associated with the OAuth token.

---

## User Stories

1. As a vehicle owner, I want to authenticate my AI assistant using a LubeLogger API key instead of my account password, so that my master account password is never stored or vulnerable to decryption.
2. As a security-conscious homelab operator, I want `lubelogger-mcp` to never write plaintext or decodable master passwords to disk, so that my server adheres to least-privilege security principles.
3. As a user connecting Claude Desktop or Cursor, I want the OAuth authorization screen to visually match my LubeLogger dashboard theme and branding, so that I have a consistent and trustworthy user experience.
4. As a user unfamiliar with LubeLogger API keys, I want the authorization screen to explain where to find or generate an API key (`Settings ➔ Profile`), so that I can set up integration quickly without searching external docs.
5. As a vehicle owner with an existing LubeLogger API key, I want the API Key tab/input to be active by default on the authorization page, so that I can paste my key and authorize with minimal clicks.
6. As a user who accidentally enters an invalid or expired API key, I want to see a clear, helpful error message on the authorization screen, so that I can correct the key and retry without breaking the OAuth handshake.
7. As an AI assistant client, I want the authorization server to adhere strictly to OAuth 2.1 PKCE (`S256`) and RFC 7591 Dynamic Client Registration, so that client connection handshakes continue to work seamlessly.
8. As a user who previously authorized an AI assistant, I want to revoke the assistant's access at any time by regenerating my API key in LubeLogger, so that I retain full control over third-party access to my garage data.
9. As a vehicle owner managing multiple vehicles, I want my authenticated session to resolve vehicles by human-friendly names (e.g. "Outback") in-process, so that the AI assistant can execute commands accurately.
10. As a developer deploying `lubelogger-mcp` in Docker, I want all token operations to work with file-backed persistence in `DATA_DIR`, so that authorization states persist across container restarts.
11. As a user, I want the authorization form to cleanly handle CSRF states, scopes, and redirect URIs without exposing tokens in browser history or URL query strings.
12. As an administrator reviewing server logs, I want `lubelogger-mcp` to never log raw API keys or credentials in stdout or error traces, so that credentials remain protected in production monitoring.

---

## Implementation Decisions

### 1. Authorization Interface Styling & Layout
- Re-architect the HTML rendered by `renderAuthorizePage` in the Embedded OAuth 2.1 Server to use LubeLogger's dark design tokens:
  - Background surface: `#0F172A` / `#1E293B`
  - Accent / Primary action: `#0284C7` (Sky 600) with hover `#0369A1` (Sky 700)
  - Card borders: `#334155` (Slate 700)
  - Typography: System sans-serif stack matching LubeLogger (`Inter, system-ui, -apple-system, sans-serif`)
  - Iconography: Official **LubeLogger MCP logo** (`/logo-dark.svg` / `docs/logo-dark.svg`) featuring the automotive steering wheel rim, amber lube oil droplet with AI spark negative space cutout, and styled "MCP" lockup badge.
- Place the **API Key** input front and center as the default active panel.
- Add an informational guidance callout:
  - *"How to get an API Key: In LubeLogger, go to **Settings ➔ Profile ➔ API Keys** and click **Generate** with Editor or Manager permissions."*

### 2. Credential Handling and Password Elimination
- The authorization form defaults `auth_mode` to `api`.
- When an API key is submitted:
  - Call `verifyLubeLoggerCredentials(serverUrl, { apiKey })` against `GET /api/vehicles`.
  - Upon 200 OK, associate the user's credential `{ apiKey }` with the authorization code and subsequent OAuth access/refresh tokens.
  - Zero password fields are present or populated in `UserCredentials` (`{ apiKey: string }`).
- Retain the secondary "Account" login tab only if explicitly needed, but display a prominent security notice recommending API keys to avoid decodable credential storage.

### 3. Token Storage Schema & Encryption
- In `tokenStore.ts`, `UserCredentials` will store `{ apiKey: string }` as the standard credential payload.
- The stored credential payload is encrypted using AES-256-GCM with authenticated tags (`iv`, `tag`, `data`). Because the payload contains only an API key (a disposable bearer token), compromising the store grants no access to master passwords or web UI accounts.
- The `DefaultLubeLoggerGateway` creates an authenticated gateway instance scoped to `{ apiKey }`, injecting `x-api-key: <apiKey>` into all downstream LubeLogger REST calls.

### 4. Backwards Compatibility
- Existing stored tokens that already contain valid credentials continue to decrypt and function without requiring users to re-authenticate immediately.
- Legacy configuration with environment variable `LUBELOGGER_API_KEY` continues to work for static single-user deployments.

---

## Testing Decisions

### Test Philosophy
- **External Behavior Only:** Tests must exercise the application through its public HTTP boundaries, verifying requests, status codes, redirects, HTML UI elements, and gateway delegation.
- No testing of private helper functions or internal class states.

### Seam Architecture
- **Single Test Seam:** The highest-level HTTP interface of the Express application created via `createApp(config)`, driven by `supertest`.
- LubeLogger upstream interactions are mocked via standard `fetchFn` injection on `GET /api/vehicles`.

### Test Coverage Scenarios
1. **GET `/authorize` Rendering:**
   - Verifies the response returns HTTP 200 with HTML content.
   - Verifies the API Key input is rendered as the primary/default input.
   - Verifies the guidance text directing users to *Settings ➔ Profile ➔ API Keys* is present in the HTML.
   - Verifies the LubeLogger branding (logo, title, theme colors) is present.
2. **POST `/authorize` with Valid API Key:**
   - Submits `auth_mode=api` with a valid `api_key`.
   - Verifies that `fetchFn` receives `x-api-key: valid-key` against `/api/vehicles`.
   - Verifies the server issues an HTTP 302 redirect to the client's `redirect_uri` with a valid authorization `code`.
   - Verifies that no `password` is present in the stored token credentials.
3. **POST `/authorize` with Invalid API Key:**
   - Submits an invalid or unauthorized API key.
   - Verifies the server re-renders `/authorize` with HTTP 401/400 and an error banner explaining the key was rejected by LubeLogger.
4. **End-to-End Token Exchange and MCP Execution:**
   - Exchanges the authorization code at `POST /token` for an `access_token`.
   - Dispatches `POST /mcp` tool execution (`manage_vehicles` or `get_vehicle_info`) with `Authorization: Bearer <access_token>`.
   - Verifies that downstream LubeLogger requests carry `x-api-key: valid-key` and execute successfully.

---

## Out of Scope

- Modifying upstream LubeLogger C# code (e.g. adding native ASP.NET Core OAuth authorization server endpoints).
- Integrating external OpenID Connect identity providers (e.g. Authentik, Pocket ID) into `lubelogger-mcp` (covered in Option 2).
- Managing multi-user role ACLs inside `lubelogger-mcp` (LubeLogger itself manages role permissions for each API key).

---

## Further Notes

- This pattern directly mirrors Home Assistant’s Long-Lived Access Token paradigm used in `ha-mcp`.
- The user can revoke or rotate their API key inside LubeLogger at any time, immediately invalidating `lubelogger-mcp`'s access without needing to reset their LubeLogger user account password.
