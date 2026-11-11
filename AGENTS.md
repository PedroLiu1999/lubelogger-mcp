## Agent Guidelines for lubelogger-mcp

### Architecture Principles

1. **Self-Contained Gateway**: All LubeLogger REST API interactions are encapsulated in `src/gateway/lubeLoggerGateway.ts`.
2. **In-Process Name Resolution**: Always resolve human-friendly names (e.g. `"2020 Subaru Outback"` or `"Outback"`) to validated numeric IDs using `resolveVehicle()` in `src/gateway/resolver.ts`.
3. **Consolidated Deep Facades**: All entity mutations are grouped under consolidated `manage_*` facades (`manage_vehicles`, `manage_records`, `manage_reminders`, `manage_plans`, `manage_supplies`) with standardized envelopes (`ResourceFacadeResult`).
4. **Safety Annotations**: Every MCP tool must include explicit `annotations`: `{ readOnlyHint: boolean, destructiveHint: boolean }`.
5. **OAuth 2.1 Compliance**: All authorization code and token flows adhere strictly to PKCE S256 and RFC 7591 dynamic client registration.
