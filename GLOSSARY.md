# LubeLogger MCP

A self-contained Model Context Protocol (MCP) server that connects a self-hosted LubeLogger vehicle maintenance instance to AI assistants over Streamable HTTP and OAuth 2.1.

## Language

### Garage & Vehicles

**Garage**:
The collection of vehicles and maintenance data managed within a LubeLogger instance.
_Avoid_: Fleet (unless commercial), car lot

**Vehicle**:
An automotive entity tracked in LubeLogger, identified by an integer `id`, year, make, model, license plate, and fuel type.
_Avoid_: Car, auto, machine

**Vehicle Identifier**:
A human-readable query string (e.g. `"Civic"`, `"2019 Honda Civic"`, `"ABC-123"`) or numerical ID resolved in-process to a unique vehicle.
_Avoid_: Car name, tag

**Vehicle Cache**:
In-memory cache of garage vehicles with a configurable TTL window (`CACHE_TTL_SECONDS`), avoiding unnecessary network roundtrips during record lookups and name resolution.
_Avoid_: Vehicle database, temp store

### Records & Maintenance

**Service Record**:
A record of scheduled or routine maintenance performed on a vehicle (e.g., oil changes, tire rotations, filter replacements), tracking date, odometer reading, description, cost, and notes.
_Avoid_: Maintenance item, log

**Gas Record**:
A fuel replenishment or EV charging log entry tracking date, odometer reading, fuel volume consumed (gallons/liters), total cost, fuel economy (MPG or km/L), full tank flag, missed fuel-up flag, and battery State of Charge (SOC) percentages.
_Avoid_: Gas log, fuel entry, charge log

**Repair Record**:
An unscheduled collision, mechanical breakdown, or fix record tracking date, odometer reading, description, cost, notes, and tags.
_Avoid_: Fix log, damage record

**Upgrade Record**:
A performance modification, accessory installation, or vehicle enhancement record.
_Avoid_: Modification log, aftermarket part

**Odometer Record**:
A dedicated distance verification checkpoint tracking date and verified odometer mileage, supporting automatic timeline recalculation.
_Avoid_: Mileage log, speedometer check

**Reminder**:
A scheduled future maintenance notification triggered by elapsed time (due date), accumulated distance (due odometer mileage), or whichever occurs first (`Metric: Both`). Has urgency ratings (`NotUrgent`, `Urgent`, `VeryUrgent`).
_Avoid_: Alert, alarm, scheduled task

**Plan Record**:
A forward-looking planned maintenance or upgrade item organized by priority (`Critical`, `Normal`, `Low`) and stage (`Backlog`, `InProgress`, `Testing`, `Done`).
_Avoid_: Todo, backlog item

**Supply Record**:
A tracked spare part, consumable (e.g., oil filter, brake fluid), or garage inventory item with part number, supplier, quantity on hand, and unit cost.
_Avoid_: Inventory item, parts catalog

### Architecture & OAuth

**Streamable HTTP**:
The MCP transport mechanism operating over `POST /mcp` with full support for JSON responses and bi-directional streaming events.
_Avoid_: SSE-only, standard REST

**Embedded OAuth 2.1 Server**:
The built-in RFC 6749 / RFC 7636 / RFC 7591 OAuth server that handles client authorization, PKCE verification (`S256`), dynamic client registration, and access/refresh token lifecycle without third-party identity providers.
_Avoid_: External auth, Clerk, Auth0

**Consent Passphrase**:
The single admin secret (`OAUTH_ADMIN_PASSWORD`) prompted on the HTML authorization screen when granting an AI assistant access to the MCP server.
_Avoid_: User password, login credential

**Resource Facade**:
A consolidated, multi-action MCP tool (e.g., `manage_vehicles`, `manage_records`) providing create, update, and delete actions with in-process name resolution and standardized result envelopes.
_Avoid_: RPC function, CRUD wrapper
