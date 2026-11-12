# 01: Sanitize Public Health Check Endpoint

**What to build:** An unauthenticated health check endpoint (`GET /healthz`) that returns high-level system readiness (`{ status: "ok", ready: true }`) while redacting internal infrastructure details, such as the upstream LubeLogger server URL (private IP/cluster DNS), backend software versions, or internal connection error strings.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] `GET /healthz` returns HTTP 200 with `{ status: "ok", ready: true }` when the gateway is healthy
- [x] `GET /healthz` response JSON does NOT contain `serverUrl` or `serverVersion`
- [x] `GET /healthz` response does not expose internal network addresses or raw connection errors
- [x] Existing health probe consumers continue to receive standard HTTP 200 responses
