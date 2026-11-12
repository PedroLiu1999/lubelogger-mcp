# 02: Consolidate MCP Transport Method Guards and Prune Redundant Metadata Route

**What to build:** A unified method guard on the `/mcp` transport path that only permits `POST` requests and rejects all invalid HTTP verbs (`GET`, `DELETE`, `PUT`, `PATCH`, `HEAD`) with HTTP 405 Method Not Allowed and an `Allow: POST` header, removing discrete dummy legacy handlers. Unmounts the redundant root metadata endpoint `/.well-known/oauth-protected-resource`, preserving only the canonical RFC 9728 endpoint `/.well-known/oauth-protected-resource/mcp`.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] `POST /mcp` continues to handle authenticated Streamable HTTP JSON-RPC traffic
- [x] Non-POST requests to `/mcp` (`GET`, `DELETE`, `PUT`, `PATCH`) return HTTP 405 Method Not Allowed
- [x] HTTP 405 responses include an `Allow: POST` header and a JSON-RPC error payload
- [x] Legacy individual handlers for `GET /mcp` and `DELETE /mcp` are removed
- [x] `/.well-known/oauth-protected-resource/mcp` serves valid RFC 9728 resource metadata
- [x] Redundant root endpoint `/.well-known/oauth-protected-resource` is unmounted
