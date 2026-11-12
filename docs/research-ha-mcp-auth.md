# Research: How HA-MCP Handles Authentication Against Home Assistant

**Question:** *How does `ha-mcp` handle authentication against a Home Assistant server?*  
**Date:** 2026-11-12  
**Author:** Antigravity Research Agent  
**Status:** Complete  

---

## Executive Summary

**Direct Answer:**  
`ha-mcp` ([homeassistant-ai/ha-mcp](https://github.com/homeassistant-ai/ha-mcp)) authenticates against the Home Assistant (HA) server across **two distinct communication channels** (REST API and WebSocket API) using Home Assistant **Long-Lived Access Tokens (LLAT)** (or internal **`SUPERVISOR_TOKEN`** when running as a Home Assistant OS Add-on). 

The exact authentication mechanism between `ha-mcp` and the Home Assistant backend varies depending on the deployment model:

1. **REST API Transport (`httpx` / `rest_client.py`):** Uses standard HTTP Bearer token authentication in the request header (`Authorization: Bearer <TOKEN>`) for static queries, configs, and entity state snapshots.
2. **WebSocket API Transport (`websockets` / `websocket_client.py`):** Establishes a persistent socket connection to `/api/websocket`, receives HA's initial `{"type": "auth_required"}` challenge, and responds with a handshake payload `{"type": "auth", "access_token": "<TOKEN>"}` to receive `{"type": "auth_ok"}`. This channel powers real-time commands, event subscriptions, service calls, and template rendering.
3. **Supervisor API (HA Add-on Mode):** When deployed as an official HA OS Add-on, `ha-mcp` bypasses manual token generation by consuming the platform-injected `SUPERVISOR_TOKEN` environment variable to authenticate against `http://supervisor/core/api`.
4. **OAuth 2.1 Proxy Variant (`ha-mcp-oauth`):** When serving remote web/cloud AI clients (e.g., Claude.ai or ChatGPT), `ha-mcp-oauth` acts as an OAuth 2.1 provider toward the AI client while capturing and storing the user's Home Assistant LLAT via an interactive consent form to relay downstream requests to the Home Assistant instance.

---

## 1. Primary Sources & Architectural Grounding

* **Upstream HA-MCP Repository:** [github.com/homeassistant-ai/ha-mcp](https://github.com/homeassistant-ai/ha-mcp)
* **Official HA-MCP Documentation:** [homeassistant-ai.github.io/ha-mcp](https://homeassistant-ai.github.io/ha-mcp/)
* **Home Assistant Authentication API Specification:** [developers.home-assistant.io/docs/auth_api/](https://developers.home-assistant.io/docs/auth_api/)
* **Home Assistant WebSocket API Specification:** [developers.home-assistant.io/docs/api/websocket/](https://developers.home-assistant.io/docs/api/websocket/)
* **Home Assistant Supervisor API Specification:** [developers.home-assistant.io/docs/supervisor/api/](https://developers.home-assistant.io/docs/supervisor/api/)

---

## 2. Authentication Boundaries in HA-MCP

Similar to other MCP gateway servers, `ha-mcp` operates across two separate boundaries:

```
┌───────────────────────────┐                     ┌───────────────────────────┐                     ┌───────────────────────────┐
│     AI Client / Agent     │  ── Boundary 1 ──▶  │          HA-MCP           │  ── Boundary 2 ──▶  │   Home Assistant Server   │
│ (Claude Desktop, Cursor,  │   MCP Transport     │   (MCP Server Gateway)    │    REST & WebSocket │ (Core / Supervised / OS)  │
│      Claude.ai, etc.)     │ (stdio, SSE, HTTP)  │                           │         APIs        │                           │
└───────────────────────────┘                     └───────────────────────────┘                     └───────────────────────────┘
```

* **Boundary 1 (Client ➔ `ha-mcp`):** Negotiated via standard MCP transports (`stdio`, Streamable HTTP with secret capability URLs, or OAuth 2.1).
* **Boundary 2 (`ha-mcp` ➔ Home Assistant):** This is the core subject of this investigation — how `ha-mcp` presents credentials to the Home Assistant server.

---

## 3. Communication Protocols & Auth Mechanisms

`ha-mcp` implements a dual-client architecture located in `src/ha_mcp/client/`:

### 3.1 REST API (`src/ha_mcp/client/rest_client.py`)
* **Underlying Library:** `httpx` (async HTTP client).
* **Endpoint:** `http(s)://<HOMEASSISTANT_URL>/api/...`
* **Authentication Scheme:** Standard HTTP Bearer Token (RFC 6750).
* **Request Header:**
  ```http
  GET /api/states HTTP/1.1
  Host: homeassistant.local:8123
  Authorization: Bearer <HOMEASSISTANT_TOKEN>
  Content-Type: application/json
  ```
* **Use Cases in `ha-mcp`:**
  - Querying entity states, areas, and device registries.
  - Inspecting Lovelace UI dashboard configurations.
  - Reading core logs and system configuration snapshots.

### 3.2 WebSocket API (`src/ha_mcp/client/websocket_client.py`)
* **Underlying Library:** Python `websockets` module.
* **Endpoint:** `ws(s)://<HOMEASSISTANT_URL>/api/websocket`
* **Handshake Protocol:**
  Home Assistant requires an explicit JSON challenge-response handshake over the open WebSocket connection before accepting any commands:
  1. **Server Challenge:** Upon connection, Home Assistant sends:
     ```json
     {
       "type": "auth_required",
       "ha_version": "2024.x.x"
     }
     ```
  2. **Client Auth Response:** `ha-mcp` responds with the configured token:
     ```json
     {
       "type": "auth",
       "access_token": "<HOMEASSISTANT_TOKEN>"
     }
     ```
  3. **Server Verification:**
     - **Success:** Home Assistant returns:
       ```json
       {
         "type": "auth_ok",
         "ha_version": "2024.x.x"
       }
       ```
     - **Failure:** Home Assistant returns `{"type": "auth_invalid", "message": "Invalid password"}` and immediately closes the socket.
* **Use Cases in `ha-mcp`:**
  - Executing real-time service calls and entity toggles (`ha_call_service`, `ha_set_entity`).
  - Evaluating Jinja2 templates dynamically (`ha_eval_template`).
  - Fetching entity state history and automation traces.
  - Subscribing to event streams.

---

## 4. Deployment Models and Credential Provisioning

`ha-mcp` supports four primary deployment modes, each provisioning credentials to Home Assistant differently:

| Deployment Mode | Transport to Client | How `ha-mcp` Obtains HA Credentials | Auth to Home Assistant Server |
| :--- | :--- | :--- | :--- |
| **Local CLI / Stdio** | `stdio` | Environment variables (`HOMEASSISTANT_URL`, `HOMEASSISTANT_TOKEN`) | Long-Lived Access Token (Bearer + WS Handshake) |
| **HA Custom Component (HACS)** | HTTP / SSE / Webhook | Runs in-process inside Home Assistant (`hass` Core instance) | In-process native Home Assistant Core API |
| **HA OS Add-on** | HTTP / Private URL | Auto-injected container environment variable (`SUPERVISOR_TOKEN`) | Supervisor API / Core WebSocket Handshake |
| **Remote OAuth Server (`ha-mcp-oauth`)** | OAuth 2.1 + SSE/HTTP | Interactive OAuth consent screen where user inputs their HA LLAT | User-supplied Long-Lived Access Token |

---

### 4.1 Mode 1: Local CLI / Stdio Deployment (e.g., Claude Desktop via `uvx`)
When running locally via `uvx ha-mcp` or Python CLI, the user generates a **Long-Lived Access Token (LLAT)** from their Home Assistant profile:
1. Navigate to `Profile` ➔ `Security` ➔ `Long-Lived Access Tokens` ➔ `Create Token`.
2. Configure the MCP client (e.g. `claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "home-assistant": {
         "command": "uvx",
         "args": ["ha-mcp@latest"],
         "env": {
           "HOMEASSISTANT_URL": "http://homeassistant.local:8123",
           "HOMEASSISTANT_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
         }
       }
     }
   }
   ```
3. `ha-mcp` loads these environment variables at process startup and injects them into its `RESTClient` and `WebSocketClient`.

---

### 4.2 Mode 2: Home Assistant Custom Component (`custom_components/ha_mcp_tools`)
When installed via HACS as a native integration:
* The server runs directly within Home Assistant’s Python execution environment (`async_setup_entry`).
* It accesses the local `hass` instance directly, eliminating network token hops for internal operations.
* For incoming AI client connections, it exposes a **Secret Capability URL** (e.g., `https://ha.example.com/api/webhook/<secret_uuid>`) or an optional `ha_auth` setting that challenges incoming connections against Home Assistant’s user account database.

---

### 4.3 Mode 3: Home Assistant OS Add-on
When installed as an official HA OS Add-on (Docker container managed by HA Supervisor):
* The Home Assistant Supervisor manages the container lifecycle and automatically injects:
  - `SUPERVISOR_TOKEN`: Environment variable with scoped privileges.
  - `HASSIO_TOKEN`: Alias token for internal communication.
* `ha-mcp` communicates with the supervisor REST endpoint at `http://supervisor/core/api` without requiring the user to manually copy/paste an access token.
* WebSocket connections to `/api/websocket` utilize the supervisor token during the `{"type": "auth", "access_token": ...}` handshake.

---

### 4.4 Mode 4: Standalone / Multi-Tenant OAuth Server (`ha-mcp-oauth`)
For cloud clients (like Claude.ai or ChatGPT) connecting to a remote MCP endpoint:
1. `ha-mcp-oauth` is deployed with `HOMEASSISTANT_URL` and `MCP_BASE_URL` defined.
2. The AI client initiates an OAuth 2.1 authorization code flow with PKCE (`S256`).
3. During the user consent phase, `ha-mcp-oauth` renders a login form where the user supplies their Home Assistant URL and a Long-Lived Access Token.
4. `ha-mcp-oauth` validates this token by sending a test request to Home Assistant (`GET /api/`).
5. Upon successful validation, the LLAT is stored in an encrypted session store, and an application-level MCP access token (JWT) is issued back to the AI client.
6. When incoming MCP tool requests arrive, `ha-mcp-oauth` resolves the session, extracts the stored LLAT, and queries Home Assistant.

---

## 5. Security Model, Permissions & Failure Modes

### 5.1 Administrator vs. Standard User Tokens
Home Assistant assigns permissions based on the user account that minted the Long-Lived Access Token:
* **Administrator Token:** Required for modifying automations, editing scripts, updating dashboard layouts, checking system logs, and triggering administrative service calls.
* **Standard User Token:** Sufficient for reading entity states and controlling permitted devices, but Home Assistant will return HTTP `403 Forbidden` or WebSocket `unauthorized` errors if administrative tools are invoked.
* **Best Practice:** The official documentation recommends creating a dedicated user account (e.g. `ha-mcp-bot`) configured as an Administrator with *Local access only*, ensuring an audit trail for actions performed by the AI agent.

### 5.2 Common Failure Modes
1. **WebSocket Authentication Timeout:**  
   If the WebSocket connection fails to complete the `{"type": "auth", ...}` handshake within the timeout window (typically 10 seconds), Home Assistant forcibly drops the TCP socket.
2. **IP Banning (`ip_ban_enabled`):**  
   If Home Assistant's `http:` component has IP banning enabled and `ha-mcp` repeatedly attempts connection with an expired or invalid token, Home Assistant adds the client IP (or `127.0.0.1` in loopback setups) to `ip_bans.yaml`, returning HTTP `403 Forbidden` on all subsequent attempts.
3. **SSL / CA Certificate Verification:**  
   Because `httpx` does not use the operating system trust store by default (relying instead on `certifi`), connecting to local Home Assistant instances with custom internal CAs or self-signed certificates requires configuring `SSL_CERT_FILE` or explicit verification flags.

---

## 6. Summary Comparison: `ha-mcp` vs. `lubelogger-mcp`

| Architectural Dimension | `ha-mcp` (Home Assistant) | `lubelogger-mcp` (LubeLogger) |
| :--- | :--- | :--- |
| **Backend API Nature** | REST + Persistent WebSocket | REST API only |
| **Native Auth Method** | Long-Lived Access Tokens (JWT) / Supervisor Token | Static API Key (`x-api-key`) or HTTP Basic Auth |
| **Auth Handshake** | HTTP Bearer + WebSocket Challenge-Response | Direct HTTP Headers (`x-api-key`, `Authorization`) |
| **In-Process Mode** | Supported via HACS Custom Component (`hass`) | Not applicable (external process communicating over HTTP) |
| **Remote Transport Auth** | Embedded Secret URL or `ha-mcp-oauth` proxy | Embedded OAuth 2.1 Server (RFC 7591 / PKCE S256) |
