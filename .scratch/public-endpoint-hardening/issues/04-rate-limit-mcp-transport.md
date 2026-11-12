# 04: Rate Limit MCP Transport

**What to build:** Request rate limiting on `POST /mcp` that defends against connection floods and resource exhaustion without impacting normal AI assistant tool usage.

**Blocked by:** 02: Consolidate MCP Transport Method Guards and Prune Redundant Metadata Route

**Status:** closed

- [x] `POST /mcp` enforces a rate limit threshold (e.g. 120 requests per minute)
- [x] Requests exceeding the rate limit receive HTTP 429 Too Many Requests with standard rate limit headers
- [x] Legitimate assistant requests within normal operational burst limits proceed unimpeded
