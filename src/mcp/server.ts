import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createResourceFacadeErrorResponse } from '../gateway/resolver.js';
import type {
  LubeLoggerGateway,
  ManagePlansInput,
  ManageRecordsInput,
  ManageRemindersInput,
  ManageSuppliesInput,
  ManageVehiclesInput,
  SupportedRecordType,
} from '../gateway/types.js';
import { BRAND_ICON_DATA_URI } from './icon.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

async function executeResourceFacadeTool(
  operation: () => Promise<unknown>,
): Promise<{
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
}> {
  try {
    const result = await operation();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(createResourceFacadeErrorResponse(error), null, 2),
        },
      ],
    };
  }
}

export function createMcpServer(
  gateway: LubeLoggerGateway,
  publicUrl?: string,
): McpServer {
  const server = new McpServer(
    {
      name: 'lubelogger-mcp',
      version: '1.1.2',
      description: 'Model Context Protocol server for LubeLogger vehicle maintenance tracker',
      icons: [
        {
          src: BRAND_ICON_DATA_URI,
          mimeType: 'image/svg+xml',
          sizes: ['256x256'],
        },
        ...(publicUrl
          ? [
              {
                src: `${publicUrl}/logo-symbol.svg`,
                mimeType: 'image/svg+xml',
                sizes: ['256x256'],
              },
              {
                src: `${publicUrl}/logo.png`,
                mimeType: 'image/png',
                sizes: ['760x256'],
              },
            ]
          : []),
      ],
      websiteUrl: publicUrl ?? 'https://github.com/hargata/lubelog',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ---------------------------------------------------------------------------
  // 1. Read Tools (readOnlyHint: true, destructiveHint: false)
  // ---------------------------------------------------------------------------

  server.registerTool(
    'get_server_info',
    {
      title: 'Get Server Information',
      description: 'Get LubeLogger instance information, version, and database health metrics.',
      inputSchema: {
        checkForUpdate: z
          .boolean()
          .optional()
          .describe('Check if a newer version of LubeLogger is available.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ checkForUpdate }) => {
      const [version, info, health] = await Promise.all([
        gateway.getServerVersion(checkForUpdate),
        gateway.getServerInfo().catch(() => ({})),
        gateway.getHealth().catch(() => ({ status: 'unknown', healthy: false })),
      ]);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ version, info, health }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_vehicles',
    {
      title: 'List Vehicles',
      description:
        'List all vehicles in the garage with ID, year, make, model, license plate, fuel type, and tags.',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force bypass of local vehicle cache to fetch live data from LubeLogger.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      const vehicles = await gateway.listVehicles(
        forceSync !== undefined ? { forceSync } : undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: vehicles.length, vehicles }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_vehicle_info',
    {
      title: 'Get Vehicle Info',
      description:
        'Get detailed statistics and cost metrics for a vehicle (resolved by ID, license plate, or name) including total service cost, repair cost, upgrade cost, gas cost, tax cost, and pending reminder counts.',
      inputSchema: {
        vehicle: z
          .union([z.string(), z.number()])
          .describe('Vehicle ID, license plate, or name (e.g. 1, "2019 Honda Civic", or "Civic").'),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force bypass of local cache.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vehicle, forceSync }) => {
      const vehicles = await gateway.listVehicles(
        forceSync !== undefined ? { forceSync } : undefined,
      );
      const { resolveVehicle } = await import('../gateway/resolver.js');
      const resolved = resolveVehicle(vehicle, vehicles);
      const info = await gateway.getVehicleInfo(resolved.id, { forceSync });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                resolvedVehicle: resolved.name,
                vehicleId: resolved.id,
                ...info,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_records',
    {
      title: 'Get Records',
      description:
        'Query records for a specific vehicle or across all vehicles by record type with optional date and tag filters.',
      inputSchema: {
        recordType: z
          .enum([
            'service',
            'repair',
            'upgrade',
            'gas',
            'odometer',
            'tax',
            'note',
            'reminder',
            'plan',
            'supply',
            'equipment',
          ])
          .describe('Type of records to query.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Optional vehicle ID, license plate, or name to restrict results to a single vehicle.'),
        startDate: isoDateSchema
          .optional()
          .describe('Optional inclusive start date in YYYY-MM-DD format.'),
        endDate: isoDateSchema
          .optional()
          .describe('Optional inclusive end date in YYYY-MM-DD format.'),
        tags: z
          .string()
          .optional()
          .describe('Optional space-separated tags to filter records by.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Maximum number of records to return (1-500).'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async (args) => {
      const filter = stripUndefined(args);
      const records = await gateway.getRecords(
        args.recordType as SupportedRecordType,
        filter,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                recordType: args.recordType,
                count: records.length,
                records,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_maintenance_summary',
    {
      title: 'Get Maintenance Summary',
      description:
        'Aggregate maintenance and operating costs (service, repair, upgrade, gas, tax) and active reminders for a specific vehicle or for the entire garage.',
      inputSchema: {
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID, license plate, or name. If omitted, returns garage-wide summary.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vehicle }) => {
      let vehicleId: number | undefined;
      if (vehicle !== undefined) {
        const vehicles = await gateway.listVehicles();
        const { resolveVehicle } = await import('../gateway/resolver.js');
        const resolved = resolveVehicle(vehicle, vehicles);
        vehicleId = resolved.id;
      }
      const summary = await gateway.getMaintenanceSummary(vehicleId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_reminders',
    {
      title: 'List Reminders',
      description:
        'List maintenance reminders across all vehicles or for a specific vehicle with urgency and due status.',
      inputSchema: {
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID, license plate, or name.'),
        urgency: z
          .enum(['NotUrgent', 'Urgent', 'VeryUrgent'])
          .optional()
          .describe('Filter by reminder urgency level.'),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force bypass of local vehicle cache.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vehicle, urgency, forceSync }) => {
      let vehicleId: number | undefined;
      if (vehicle !== undefined) {
        const vehicles = await gateway.listVehicles({ forceSync });
        const { resolveVehicle } = await import('../gateway/resolver.js');
        const resolved = resolveVehicle(vehicle, vehicles);
        vehicleId = resolved.id;
      }

      const reminders = await gateway.listReminders({
        vehicleId,
        urgency,
        forceSync,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: reminders.length, reminders }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_extra_fields',
    {
      title: 'Get Extra Fields',
      description: 'List user-defined custom extra fields configured for vehicles and records.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      const extraFields = await gateway.getExtraFields();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ extraFields }, null, 2),
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 2. Deep Resource Facades (readOnlyHint: false, destructiveHint: true)
  // ---------------------------------------------------------------------------

  server.registerTool(
    'manage_vehicles',
    {
      title: 'Manage Vehicles',
      description:
        'Consolidated Resource Facade for vehicle lifecycle (action: "create" | "update" | "delete"). Supports in-process name/plate resolution on update/delete.',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Lifecycle action to perform.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID, license plate, or name (required for update and delete).'),
        year: z
          .number()
          .int()
          .min(1900)
          .max(2100)
          .optional()
          .describe('Vehicle model year (e.g. 2021).'),
        make: z
          .string()
          .optional()
          .describe('Vehicle manufacturer make (e.g. "Toyota", "Honda").'),
        model: z
          .string()
          .optional()
          .describe('Vehicle model name (e.g. "RAV4", "Civic").'),
        licensePlate: z
          .string()
          .optional()
          .describe('Vehicle license plate number.'),
        fuelType: z
          .string()
          .optional()
          .describe('Fuel type (e.g. "Gasoline", "Diesel", "Electric", "Hybrid").'),
        isElectric: z
          .boolean()
          .optional()
          .describe('Whether the vehicle is electric/EV.'),
        tags: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe('Tags associated with vehicle.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      return executeResourceFacadeTool(() =>
        gateway.manageVehicles(stripUndefined(args) as ManageVehiclesInput),
      );
    },
  );

  server.registerTool(
    'manage_records',
    {
      title: 'Manage Records',
      description:
        'Consolidated Resource Facade for vehicle maintenance records (recordType: "service" | "repair" | "upgrade" | "gas" | "tax" | "note" | "odometer", action: "create" | "update" | "delete"). Automatically resolves vehicle names in-process.',
      inputSchema: {
        recordType: z
          .enum(['service', 'repair', 'upgrade', 'gas', 'tax', 'note', 'odometer'])
          .describe('Type of maintenance record.'),
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Action to execute.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Target vehicle ID, license plate, or name (required for create).'),
        id: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Record ID (required for update and delete).'),
        date: isoDateSchema
          .optional()
          .describe('Date of record in YYYY-MM-DD format (defaults to today).'),
        odometer: z
          .number()
          .optional()
          .describe('Odometer/mileage reading at time of service or fuel-up.'),
        description: z
          .string()
          .optional()
          .describe('Description of the service, repair, or note.'),
        cost: z
          .number()
          .optional()
          .describe('Decimal cost in currency units (e.g. 45.50).'),
        notes: z
          .string()
          .optional()
          .describe('Optional notes or work details.'),
        tags: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe('Optional space-separated or array of tags.'),
        // Gas-specific
        fuelConsumed: z
          .number()
          .optional()
          .describe('Fuel volume consumed in gallons or liters (gas records only).'),
        isFillToFull: z
          .boolean()
          .optional()
          .describe('Whether this was a full tank fill-up (gas records only).'),
        missedFuelUp: z
          .boolean()
          .optional()
          .describe('Whether a previous fuel-up was missed (gas records only).'),
        startingSoc: z
          .number()
          .optional()
          .describe('Starting state of charge % for EV charging (gas/charge records only).'),
        endingSoc: z
          .number()
          .optional()
          .describe('Ending state of charge % for EV charging (gas/charge records only).'),
        // Note-specific
        noteText: z
          .string()
          .optional()
          .describe('Full note content (note records only).'),
        pinned: z
          .boolean()
          .optional()
          .describe('Whether the note is pinned (note records only).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      return executeResourceFacadeTool(() =>
        gateway.manageRecords(stripUndefined(args) as ManageRecordsInput),
      );
    },
  );

  server.registerTool(
    'manage_reminders',
    {
      title: 'Manage Reminders',
      description:
        'Consolidated Resource Facade for vehicle reminders (action: "create" | "update" | "delete").',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Action to execute.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID, license plate, or name (required for create).'),
        id: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Reminder ID (required for update and delete).'),
        description: z
          .string()
          .optional()
          .describe('Description of the reminder (e.g. "Oil change due").'),
        urgency: z
          .enum(['NotUrgent', 'Urgent', 'VeryUrgent'])
          .optional()
          .describe('Urgency level.'),
        metric: z
          .enum(['Date', 'Odometer', 'Both'])
          .optional()
          .describe('Trigger metric: Date, Odometer, or Both.'),
        dueDate: isoDateSchema
          .optional()
          .describe('Target due date in YYYY-MM-DD format.'),
        dueOdometer: z
          .number()
          .optional()
          .describe('Target due odometer/mileage reading.'),
        notes: z
          .string()
          .optional()
          .describe('Additional notes.'),
        tags: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe('Tags.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      return executeResourceFacadeTool(() =>
        gateway.manageReminders(stripUndefined(args) as ManageRemindersInput),
      );
    },
  );

  server.registerTool(
    'manage_plans',
    {
      title: 'Manage Plans',
      description:
        'Consolidated Resource Facade for planned maintenance and future upgrades (action: "create" | "update" | "delete").',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Action to execute.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID, license plate, or name (required for create).'),
        id: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Plan ID (required for update and delete).'),
        description: z
          .string()
          .optional()
          .describe('Description of the planned task or upgrade.'),
        priority: z
          .enum(['Critical', 'Normal', 'Low'])
          .optional()
          .describe('Priority of plan item.'),
        progress: z
          .enum(['Backlog', 'InProgress', 'Testing', 'Done'])
          .optional()
          .describe('Current progress status of the plan.'),
        cost: z
          .number()
          .optional()
          .describe('Estimated cost in currency units.'),
        notes: z
          .string()
          .optional()
          .describe('Additional notes.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      return executeResourceFacadeTool(() =>
        gateway.managePlans(stripUndefined(args) as ManagePlansInput),
      );
    },
  );

  server.registerTool(
    'manage_supplies',
    {
      title: 'Manage Supplies',
      description:
        'Consolidated Resource Facade for garage supplies and parts inventory (action: "create" | "update" | "delete").',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Action to execute.'),
        vehicle: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Vehicle ID or name if supply is vehicle-specific.'),
        id: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Supply ID (required for update and delete).'),
        partNumber: z
          .string()
          .optional()
          .describe('Part number or SKU (e.g. "15400-PLM-A02").'),
        partSupplier: z
          .string()
          .optional()
          .describe('Supplier or store name.'),
        partQuantity: z
          .number()
          .optional()
          .describe('Quantity on hand.'),
        description: z
          .string()
          .optional()
          .describe('Part description (e.g. "Oil filter").'),
        cost: z
          .number()
          .optional()
          .describe('Part cost or unit price.'),
        notes: z
          .string()
          .optional()
          .describe('Notes.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      return executeResourceFacadeTool(() =>
        gateway.manageSupplies(stripUndefined(args) as ManageSuppliesInput),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Operational Tools (readOnlyHint: false, destructiveHint: false)
  // ---------------------------------------------------------------------------

  server.registerTool(
    'trigger_reminders',
    {
      title: 'Trigger Reminders',
      description:
        'Trigger automated reminder check and notification emails on the LubeLogger server.',
      inputSchema: {
        urgency: z
          .enum(['NotUrgent', 'Urgent', 'VeryUrgent'])
          .optional()
          .describe('Filter reminders to check by urgency level.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ urgency }) => {
      const res = await gateway.triggerReminders(urgency ? { urgency } : undefined);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'recalculate_odometer',
    {
      title: 'Recalculate Odometer',
      description:
        'Recalculate odometer and distance timeline for a specific vehicle across all records.',
      inputSchema: {
        vehicle: z
          .union([z.string(), z.number()])
          .describe('Vehicle ID, license plate, or name.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ vehicle }) => {
      const vehicles = await gateway.listVehicles();
      const { resolveVehicle } = await import('../gateway/resolver.js');
      const resolved = resolveVehicle(vehicle, vehicles);
      const res = await gateway.recalculateOdometer(resolved.id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                vehicleId: resolved.id,
                vehicleName: resolved.name,
                ...res,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'create_backup',
    {
      title: 'Create Backup',
      description: 'Trigger a complete database and attachments backup of the LubeLogger server.',
      inputSchema: {
        outputName: z
          .string()
          .optional()
          .describe('Optional custom backup output filename or path.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ outputName }) => {
      const res = await gateway.createBackup(outputName);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
