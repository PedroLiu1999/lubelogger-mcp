# 07: Enforce Strict Health Check Response Schema

**What to build:** Strictly return `{ status: "ok", ready: boolean }` from `GET /healthz`, removing `lastCheckedAt` to adhere to the exact minimal schema required by the spec.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] `GET /healthz` response JSON strictly contains only `status` and `ready` keys
- [x] `lastCheckedAt` is removed from the public health check JSON body
- [x] Health check integration tests assert the exact `{ status: "ok", ready: true }` schema
