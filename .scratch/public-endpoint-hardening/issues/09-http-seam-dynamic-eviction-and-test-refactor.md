# 09: Top-Level HTTP Seam Test for Dynamic Eviction & Test Refactoring

**What to build:** An end-to-end integration test through the top-level application HTTP seam (`supertest` against `createApp(options)` on `POST /register`) verifying that registering 21 dynamic clients succeeds with HTTP 201 without throwing capacity errors. Refactor triplicated Supertest request loops in `tests/app.test.ts`.

**Blocked by:** 06: Fix TokenStore Client Recency Tracking and Refactor Eviction Loops

**Status:** closed

- [x] Top-level integration test sends 21 client registration requests to `POST /register`
- [x] 21st registration returns HTTP 201 and valid client credentials
- [x] Least-recently-used client is confirmed evicted via subsequent authorization attempts
- [x] Triplicated Supertest request dispatch in `tests/app.test.ts` is refactored into a concise helper loop
