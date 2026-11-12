# 05: Implement Dynamic Client Eviction in Token Store

**What to build:** An automatic eviction mechanism for RFC 7591 dynamically registered OAuth clients in `TokenStore`. When client capacity (`MAX_REGISTERED_CLIENTS`) is reached, stale or least-recently-used registrations are recycled so new client registration requests never fail with permanent slot exhaustion.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] Registered dynamic clients track creation or last-activity timestamps
- [x] When registration limit is reached, the oldest or least recently active client registration is automatically evicted to make room for the new client
- [x] Active authorization codes and tokens associated with evicted registrations are safely handled
- [x] Dynamic client registration (`POST /register`) succeeds continuously under load without throwing `Client registration limit reached`
