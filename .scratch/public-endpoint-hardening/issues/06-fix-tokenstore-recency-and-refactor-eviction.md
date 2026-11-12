# 06: Fix TokenStore Client Recency Tracking and Refactor Eviction Loops

**What to build:** Refresh client LRU recency whenever active access tokens are looked up via `getUserCredentials(token)` or `getAccessToken(token)` so active MCP clients are never evicted when dynamic client capacity is reached. Persist client access ordering, rename `oldestClientId` to `lruClientId`, and extract an `evictTokensForClient(map, clientId)` helper.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] `getUserCredentials(token)` refreshes the LRU recency of the client associated with the token
- [x] `getAccessToken(token)` refreshes the LRU recency of the client associated with the token
- [x] `evictTokensForClient` helper cleans up tokens across both access and refresh token maps without duplicate loops
- [x] Renamed `oldestClientId` to `lruClientId` in client eviction logic
- [x] Client recency ordering is persisted to disk on update
