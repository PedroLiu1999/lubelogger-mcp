import {
  formatVehicleDisplayName,
  resolveVehicle,
  ResourceFacadeResult,
} from './resolver.js';
import type {
  ExtraField,
  GasRecord,
  GenericRecord,
  LubeLoggerGateway,
  MaintenanceSummary,
  ManagePlansInput,
  ManageRecordsInput,
  ManageRemindersInput,
  ManageSuppliesInput,
  ManageVehiclesInput,
  NoteRecord,
  OdometerRecord,
  PlanRecord,
  QueryRecordsFilter,
  ReminderRecord,
  ServerReadiness,
  SupplyRecord,
  SupportedRecordType,
  TaxRecord,
  UserCredentials,
  Vehicle,
  VehicleInfo,
} from './types.js';

export interface LubeLoggerGatewayOptions {
  serverUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  cacheTtlSeconds?: number;
  fetchFn?: typeof fetch;
}

export function buildAuthHeaders(credentials?: UserCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    'culture-invariant': 'true',
    Accept: 'application/json',
  };
  if (credentials?.apiKey) {
    headers['x-api-key'] = credentials.apiKey;
  } else if (credentials?.username && credentials?.password) {
    const token = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

interface OperationResponse {
  success?: boolean;
  message?: string;
}

export class DefaultLubeLoggerGateway implements LubeLoggerGateway {
  private readonly serverUrl: string;
  private readonly apiKey?: string;
  private readonly basicAuthToken?: string;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;

  private cachedVehicles: Vehicle[] | null = null;
  private cacheExpiresAt = 0;
  private readiness: ServerReadiness;

  constructor(options: LubeLoggerGatewayOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    if (options.username && options.password) {
      this.basicAuthToken = Buffer.from(
        `${options.username}:${options.password}`,
        'utf8',
      ).toString('base64');
    }
    this.cacheTtlMs = (options.cacheTtlSeconds ?? 30) * 1000;
    this.fetchImpl = options.fetchFn ?? globalThis.fetch.bind(globalThis);

    this.readiness = {
      ready: false,
      lastCheckedAt: null,
      serverUrl: this.serverUrl,
    };
  }

  async initialize(): Promise<void> {
    try {
      const hasCredentials = Boolean(this.apiKey || this.basicAuthToken);
      if (!hasCredentials) {
        // In dynamic/secret-free mode, probe server reachability without throwing on 401/403
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await this.fetchImpl(`${this.serverUrl}/api/vehicles`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.status === 200 || res.status === 401 || res.status === 403) {
            this.readiness = {
              ready: true,
              lastCheckedAt: new Date().toISOString(),
              serverUrl: this.serverUrl,
              serverVersion: 'dynamic-auth',
            };
            return;
          }
          throw new Error(`LubeLogger returned HTTP ${res.status}`);
        } catch (err) {
          clearTimeout(timeout);
          throw err;
        }
      }

      const version = await this.getServerVersion(false);
      this.readiness = {
        ready: true,
        lastCheckedAt: new Date().toISOString(),
        serverUrl: this.serverUrl,
        serverVersion: version.version,
      };
      await this.listVehicles({ forceSync: true });
    } catch (error) {
      this.readiness = {
        ready: false,
        lastCheckedAt: new Date().toISOString(),
        serverUrl: this.serverUrl,
        error: error instanceof Error ? error.message : String(error),
      };
      // Do not throw on initialization failure to allow server to boot and report health
    }
  }

  async shutdown(): Promise<void> {
    this.cachedVehicles = null;
    this.cacheExpiresAt = 0;
  }

  getReadiness(): ServerReadiness {
    return { ...this.readiness };
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.apiKey) {
      return buildAuthHeaders({ apiKey: this.apiKey });
    }
    if (this.basicAuthToken) {
      return {
        'culture-invariant': 'true',
        Accept: 'application/json',
        Authorization: `Basic ${this.basicAuthToken}`,
      };
    }
    return buildAuthHeaders();
  }

  private async request<T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const headers = {
      ...this.getAuthHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        headers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to connect to LubeLogger at ${this.serverUrl}: ${msg}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `LubeLogger authentication failed (HTTP ${response.status}). Verify LUBELOGGER_API_KEY or LUBELOGGER_USERNAME/PASSWORD.`,
      );
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      let errorMsg = `LubeLogger API error (HTTP ${response.status})`;
      if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
        errorMsg += `: ${data.message}`;
      } else if (typeof data === 'string' && data.length > 0) {
        errorMsg += `: ${data}`;
      }
      throw new Error(errorMsg);
    }

    return data as T;
  }

  // --- Server Info & Health ---

  async getServerInfo(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/info');
  }

  async getServerVersion(checkForUpdate = false): Promise<{ version: string; isLatest?: boolean }> {
    const query = checkForUpdate ? '?checkForUpdate=true' : '';
    const res = await this.request<string | { currentVersion?: string; version?: string }>(
      `/api/version${query}`,
    );
    if (typeof res === 'string') {
      return { version: res };
    }
    return {
      version: res?.currentVersion ?? res?.version ?? 'unknown',
    };
  }

  async getHealth(): Promise<{ status: string; healthy: boolean }> {
    try {
      const res = await this.request<unknown>('/health');
      return { status: typeof res === 'string' ? res : 'healthy', healthy: true };
    } catch (error) {
      return {
        status: error instanceof Error ? error.message : String(error),
        healthy: false,
      };
    }
  }

  // --- Vehicles ---

  async listVehicles(options?: { forceSync?: boolean }): Promise<Vehicle[]> {
    const now = Date.now();
    if (!options?.forceSync && this.cachedVehicles && now < this.cacheExpiresAt) {
      return this.cachedVehicles;
    }

    const rawVehicles = await this.request<any[]>('/api/vehicles');
    const normalized: Vehicle[] = (rawVehicles || []).map((v) => ({
      id: Number(v.id ?? v.Id),
      year: Number(v.year ?? v.Year ?? 0),
      make: String(v.make ?? v.Make ?? ''),
      model: String(v.model ?? v.Model ?? ''),
      licensePlate: String(v.licensePlate ?? v.LicensePlate ?? ''),
      soldDate: v.soldDate ?? v.SoldDate,
      isSold: Boolean(v.isSold ?? v.IsSold),
      isElectric: Boolean(v.isElectric ?? v.IsElectric),
      useEngineHours: Boolean(v.useEngineHours ?? v.UseEngineHours),
      odometerOptional: Boolean(v.odometerOptional ?? v.OdometerOptional),
      fuelType: v.fuelType ?? v.FuelType,
      tags: Array.isArray(v.tags ?? v.Tags)
        ? (v.tags ?? v.Tags)
        : typeof (v.tags ?? v.Tags) === 'string'
          ? (v.tags ?? v.Tags).split(' ').filter(Boolean)
          : [],
      extraFields: v.extraFields ?? v.ExtraFields ?? [],
    }));

    this.cachedVehicles = normalized;
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return normalized;
  }

  async getVehicleInfo(
    vehicleId: number,
    options?: { forceSync?: boolean },
  ): Promise<VehicleInfo> {
    const raw = await this.request<any>(`/api/vehicle/info?vehicleId=${vehicleId}`);
    const v = raw.vehicleData ?? raw.VehicleData ?? {};
    return {
      vehicleData: {
        id: Number(v.id ?? v.Id ?? vehicleId),
        year: Number(v.year ?? v.Year ?? 0),
        make: String(v.make ?? v.Make ?? ''),
        model: String(v.model ?? v.Model ?? ''),
        licensePlate: String(v.licensePlate ?? v.LicensePlate ?? ''),
        soldDate: v.soldDate ?? v.SoldDate,
        isSold: Boolean(v.isSold ?? v.IsSold),
        isElectric: Boolean(v.isElectric ?? v.IsElectric),
        useEngineHours: Boolean(v.useEngineHours ?? v.UseEngineHours),
        odometerOptional: Boolean(v.odometerOptional ?? v.OdometerOptional),
        fuelType: v.fuelType ?? v.FuelType,
        tags: Array.isArray(v.tags ?? v.Tags) ? v.tags ?? v.Tags : [],
      },
      lastReportedOdometer: Number(raw.lastReportedOdometer ?? raw.LastReportedOdometer ?? 0),
      serviceRecordCount: Number(raw.serviceRecordCount ?? raw.ServiceRecordCount ?? 0),
      serviceRecordCost: Number(raw.serviceRecordCost ?? raw.ServiceRecordCost ?? 0),
      repairRecordCount: Number(raw.repairRecordCount ?? raw.RepairRecordCount ?? 0),
      repairRecordCost: Number(raw.repairRecordCost ?? raw.RepairRecordCost ?? 0),
      upgradeRecordCount: Number(raw.upgradeRecordCount ?? raw.UpgradeRecordCount ?? 0),
      upgradeRecordCost: Number(raw.upgradeRecordCost ?? raw.UpgradeRecordCost ?? 0),
      gasRecordCount: Number(raw.gasRecordCount ?? raw.GasRecordCount ?? 0),
      gasRecordCost: Number(raw.gasRecordCost ?? raw.GasRecordCost ?? 0),
      taxRecordCount: Number(raw.taxRecordCount ?? raw.TaxRecordCount ?? 0),
      taxRecordCost: Number(raw.taxRecordCost ?? raw.TaxRecordCost ?? 0),
      veryUrgentReminderCount: Number(raw.veryUrgentReminderCount ?? raw.VeryUrgentReminderCount ?? 0),
      urgentReminderCount: Number(raw.urgentReminderCount ?? raw.UrgentReminderCount ?? 0),
      notUrgentReminderCount: Number(raw.notUrgentReminderCount ?? raw.NotUrgentReminderCount ?? 0),
      pastDueReminderCount: Number(raw.pastDueReminderCount ?? raw.PastDueReminderCount ?? 0),
      nextReminder: raw.nextReminder ?? raw.NextReminder,
      planRecordBackLogCount: Number(raw.planRecordBackLogCount ?? raw.PlanRecordBackLogCount ?? 0),
      planRecordInProgressCount: Number(raw.planRecordInProgressCount ?? raw.PlanRecordInProgressCount ?? 0),
      planRecordTestingCount: Number(raw.planRecordTestingCount ?? raw.PlanRecordTestingCount ?? 0),
      planRecordDoneCount: Number(raw.planRecordDoneCount ?? raw.PlanRecordDoneCount ?? 0),
    };
  }

  async getAdjustedOdometer(
    vehicleId: number,
    odometer: number,
  ): Promise<{ adjustedOdometer: number }> {
    const res = await this.request<any>(
      `/api/vehicle/adjustedodometer?vehicleId=${vehicleId}&odometer=${odometer}`,
    );
    return {
      adjustedOdometer: typeof res === 'number' ? res : Number(res?.adjustedOdometer ?? odometer),
    };
  }

  // --- Records Querying ---

  private getEndpointForRecordType(type: SupportedRecordType): string {
    switch (type) {
      case 'gas':
        return '/api/vehicle/gasrecords';
      case 'service':
        return '/api/vehicle/servicerecords';
      case 'repair':
        return '/api/vehicle/repairrecords';
      case 'upgrade':
        return '/api/vehicle/upgraderecords';
      case 'odometer':
        return '/api/vehicle/odometerrecords';
      case 'tax':
        return '/api/vehicle/taxrecords';
      case 'note':
        return '/api/vehicle/notes';
      case 'reminder':
        return '/api/vehicle/reminders';
      case 'plan':
        return '/api/vehicle/planrecords';
      case 'supply':
        return '/api/vehicle/supplyrecords';
      case 'equipment':
        return '/api/vehicle/equipmentrecords';
    }
  }

  async getRecords(
    type: SupportedRecordType,
    filter?: QueryRecordsFilter,
  ): Promise<unknown[]> {
    const baseEndpoint = this.getEndpointForRecordType(type);
    let resolvedVehicleId = filter?.vehicleId;

    if (filter?.vehicle !== undefined && resolvedVehicleId === undefined) {
      const vehicles = await this.listVehicles();
      const resolved = resolveVehicle(filter.vehicle, vehicles);
      resolvedVehicleId = resolved.id;
    }

    const queryParams = new URLSearchParams();
    if (resolvedVehicleId !== undefined) {
      queryParams.set('vehicleId', String(resolvedVehicleId));
    }
    if (filter?.startDate) {
      queryParams.set('startDate', filter.startDate);
    }
    if (filter?.endDate) {
      queryParams.set('endDate', filter.endDate);
    }
    if (filter?.tags) {
      queryParams.set('tags', filter.tags);
    }

    const path = resolvedVehicleId !== undefined
      ? `${baseEndpoint}?${queryParams.toString()}`
      : `${baseEndpoint}/all${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    let records = await this.request<any[]>(path);
    if (!Array.isArray(records)) {
      records = records ? [records] : [];
    }

    if (filter?.limit && filter.limit > 0) {
      records = records.slice(0, filter.limit);
    }

    return records;
  }

  async getMaintenanceSummary(vehicleId?: number): Promise<MaintenanceSummary> {
    const vehicles = await this.listVehicles();

    if (vehicleId !== undefined) {
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      const info = await this.getVehicleInfo(vehicleId);
      const totalCost =
        info.serviceRecordCost +
        info.repairRecordCost +
        info.upgradeRecordCost +
        info.gasRecordCost +
        info.taxRecordCost;
      const totalRecords =
        info.serviceRecordCount +
        info.repairRecordCount +
        info.upgradeRecordCount +
        info.gasRecordCount +
        info.taxRecordCount;

      return {
        vehicleId,
        vehicleName: vehicle ? formatVehicleDisplayName(vehicle) : `Vehicle #${vehicleId}`,
        totalCost,
        serviceCost: info.serviceRecordCost,
        repairCost: info.repairRecordCost,
        upgradeCost: info.upgradeRecordCost,
        gasCost: info.gasRecordCost,
        taxCost: info.taxRecordCost,
        totalRecordsCount: totalRecords,
        lastReportedOdometer: info.lastReportedOdometer,
        pendingRemindersCount:
          info.veryUrgentReminderCount +
          info.urgentReminderCount +
          info.notUrgentReminderCount +
          info.pastDueReminderCount,
        urgentRemindersCount: info.veryUrgentReminderCount + info.urgentReminderCount,
      };
    }

    // Garage-wide aggregate
    let totalCost = 0;
    let serviceCost = 0;
    let repairCost = 0;
    let upgradeCost = 0;
    let gasCost = 0;
    let taxCost = 0;
    let totalRecordsCount = 0;
    let pendingRemindersCount = 0;
    let urgentRemindersCount = 0;

    for (const v of vehicles) {
      try {
        const info = await this.getVehicleInfo(v.id);
        serviceCost += info.serviceRecordCost;
        repairCost += info.repairRecordCost;
        upgradeCost += info.upgradeRecordCost;
        gasCost += info.gasRecordCost;
        taxCost += info.taxRecordCost;
        totalRecordsCount +=
          info.serviceRecordCount +
          info.repairRecordCount +
          info.upgradeRecordCount +
          info.gasRecordCount +
          info.taxRecordCount;
        pendingRemindersCount +=
          info.veryUrgentReminderCount +
          info.urgentReminderCount +
          info.notUrgentReminderCount +
          info.pastDueReminderCount;
        urgentRemindersCount += info.veryUrgentReminderCount + info.urgentReminderCount;
      } catch {
        // Continue aggregating other vehicles
      }
    }

    totalCost = serviceCost + repairCost + upgradeCost + gasCost + taxCost;

    return {
      vehicleName: 'All Vehicles (Garage Summary)',
      totalCost,
      serviceCost,
      repairCost,
      upgradeCost,
      gasCost,
      taxCost,
      totalRecordsCount,
      pendingRemindersCount,
      urgentRemindersCount,
    };
  }

  async listReminders(options?: {
    vehicleId?: number;
    urgency?: string;
    forceSync?: boolean;
  }): Promise<ReminderRecord[]> {
    const raw = (await this.getRecords('reminder', {
      vehicleId: options?.vehicleId,
      forceSync: options?.forceSync,
    })) as any[];

    let reminders: ReminderRecord[] = raw.map((r) => ({
      id: Number(r.id ?? r.Id),
      vehicleId: Number(r.vehicleId ?? r.VehicleId),
      description: String(r.description ?? r.Description ?? ''),
      urgency: String(r.urgency ?? r.Urgency ?? 'NotUrgent'),
      metric: String(r.metric ?? r.Metric ?? 'Date'),
      userMetric: r.userMetric ?? r.UserMetric,
      notes: r.notes ?? r.Notes,
      dueDate: r.dueDate ?? r.DueDate,
      dueOdometer: r.dueOdometer != null ? Number(r.dueOdometer) : undefined,
      dueDays: r.dueDays != null ? Number(r.dueDays) : undefined,
      dueDistance: r.dueDistance != null ? Number(r.dueDistance) : undefined,
      tags: Array.isArray(r.tags ?? r.Tags)
        ? r.tags ?? r.Tags
        : typeof (r.tags ?? r.Tags) === 'string'
          ? (r.tags ?? r.Tags).split(' ').filter(Boolean)
          : [],
    }));

    if (options?.urgency) {
      const urg = options.urgency.toLowerCase();
      reminders = reminders.filter((r) => r.urgency.toLowerCase() === urg);
    }

    return reminders;
  }

  async getExtraFields(): Promise<Array<{ recordType: string; extraFields: ExtraField[] }>> {
    return this.request<Array<{ recordType: string; extraFields: ExtraField[] }>>(
      '/api/extrafields',
    );
  }

  // --- Mutating Facades ---

  async manageVehicles(input: ManageVehiclesInput): Promise<ResourceFacadeResult> {
    const vehicles = await this.listVehicles();

    if (input.action === 'create') {
      if (!input.make || !input.model) {
        throw new Error('Vehicle make and model are required to create a vehicle.');
      }
      const payload = {
        year: String(input.year ?? new Date().getFullYear()),
        make: input.make,
        model: input.model,
        licensePlate: input.licensePlate ?? '',
        fuelType: input.fuelType ?? 'Gasoline',
        isElectric: Boolean(input.isElectric),
        tags: Array.isArray(input.tags) ? input.tags.join(' ') : input.tags ?? '',
        extraFields: input.extraFields ?? [],
      };

      const res = await this.request<OperationResponse>('/api/vehicles/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      this.cachedVehicles = null;
      return {
        success: true,
        message: res.message || 'Vehicle created successfully',
        data: payload,
      };
    }

    // Update or Delete: resolve target vehicle
    const targetQuery = input.id ?? input.vehicleId ?? input.vehicle;
    if (targetQuery === undefined) {
      throw new Error(`Vehicle id or identifier is required for action "${input.action}".`);
    }
    const resolved = resolveVehicle(targetQuery, vehicles);

    if (input.action === 'delete') {
      const res = await this.request<OperationResponse>(
        `/api/vehicles/delete?id=${resolved.id}`,
        { method: 'DELETE' },
      );
      this.cachedVehicles = null;
      return {
        success: true,
        message: res.message || `Vehicle ${resolved.name} deleted successfully`,
        data: { id: resolved.id },
        resolved: { vehicle: resolved.name },
      };
    }

    if (input.action === 'update') {
      const existing = resolved.vehicle;
      const payload = {
        id: String(resolved.id),
        year: String(input.year ?? existing.year),
        make: input.make ?? existing.make,
        model: input.model ?? existing.model,
        licensePlate: input.licensePlate ?? existing.licensePlate,
        fuelType: input.fuelType ?? existing.fuelType ?? 'Gasoline',
        isElectric: input.isElectric !== undefined ? input.isElectric : existing.isElectric,
        tags: Array.isArray(input.tags)
          ? input.tags.join(' ')
          : input.tags ?? (existing.tags ? existing.tags.join(' ') : ''),
        extraFields: input.extraFields ?? existing.extraFields ?? [],
      };

      const res = await this.request<OperationResponse>('/api/vehicles/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      this.cachedVehicles = null;
      return {
        success: true,
        message: res.message || `Vehicle ${resolved.name} updated successfully`,
        data: payload,
        resolved: { vehicle: resolved.name },
      };
    }

    throw new Error(`Unsupported manageVehicles action: ${(input as any).action}`);
  }

  async manageRecords(input: ManageRecordsInput): Promise<ResourceFacadeResult> {
    const endpoint = this.getEndpointForRecordType(input.recordType);

    if (input.action === 'delete') {
      const recordId = input.id ?? input.recordId;
      if (!recordId) {
        throw new Error('Record id is required for delete action.');
      }
      const res = await this.request<OperationResponse>(
        `${endpoint}/delete?id=${recordId}`,
        { method: 'DELETE' },
      );
      return {
        success: true,
        message: res.message || `${input.recordType} record #${recordId} deleted successfully`,
        data: { id: Number(recordId), recordType: input.recordType },
      };
    }

    // Create or Update
    const vehicles = await this.listVehicles();
    let resolvedVehicleId: number | undefined;
    let resolvedVehicleName: string | undefined;

    const vehicleTarget = input.vehicle ?? input.vehicleId;
    if (vehicleTarget !== undefined) {
      const resolved = resolveVehicle(vehicleTarget, vehicles);
      resolvedVehicleId = resolved.id;
      resolvedVehicleName = resolved.name;
    }

    const tagsFormatted = Array.isArray(input.tags)
      ? input.tags.join(' ')
      : input.tags ?? '';

    let payload: Record<string, unknown>;

    switch (input.recordType) {
      case 'gas':
        payload = {
          id: input.id ? String(input.id) : undefined,
          vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
          date: input.date ?? new Date().toISOString().split('T')[0],
          odometer: String(input.odometer ?? 0),
          fuelConsumed: String(input.fuelConsumed ?? 0),
          cost: String(input.cost ?? 0),
          isFillToFull: String(input.isFillToFull ?? true),
          missedFuelUp: String(input.missedFuelUp ?? false),
          startingSoc: String(input.startingSoc ?? 20),
          endingSoc: String(input.endingSoc ?? 80),
          notes: input.notes ?? '',
          tags: tagsFormatted,
          extraFields: input.extraFields ?? [],
        };
        break;
      case 'odometer':
        payload = {
          id: input.id ? String(input.id) : undefined,
          vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
          date: input.date ?? new Date().toISOString().split('T')[0],
          initialOdometer: String(input.initialOdometer ?? input.odometer ?? 0),
          odometer: String(input.odometer ?? 0),
          notes: input.notes ?? '',
          tags: tagsFormatted,
          extraFields: input.extraFields ?? [],
        };
        break;
      case 'note':
        payload = {
          id: input.id ? String(input.id) : undefined,
          vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
          description: input.description ?? 'Note',
          noteText: input.noteText ?? input.notes ?? '',
          pinned: Boolean(input.pinned),
          tags: tagsFormatted,
          extraFields: input.extraFields ?? [],
        };
        break;
      case 'tax':
        payload = {
          id: input.id ? String(input.id) : undefined,
          vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
          date: input.date ?? new Date().toISOString().split('T')[0],
          description: input.description ?? 'Tax Record',
          cost: String(input.cost ?? 0),
          notes: input.notes ?? '',
          tags: tagsFormatted,
          extraFields: input.extraFields ?? [],
        };
        break;
      case 'service':
      case 'repair':
      case 'upgrade':
      default:
        payload = {
          id: input.id ? String(input.id) : undefined,
          vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
          date: input.date ?? new Date().toISOString().split('T')[0],
          odometer: String(input.odometer ?? 0),
          description: input.description ?? `${input.recordType} record`,
          cost: String(input.cost ?? 0),
          notes: input.notes ?? '',
          tags: tagsFormatted,
          extraFields: input.extraFields ?? [],
        };
        break;
    }

    if (input.action === 'create') {
      if (!resolvedVehicleId) {
        throw new Error('Vehicle must be specified when creating a record.');
      }
      const res = await this.request<OperationResponse>(`${endpoint}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        message: res.message || `${input.recordType} record created successfully`,
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    if (input.action === 'update') {
      const recordId = input.id ?? input.recordId;
      if (!recordId) {
        throw new Error('Record id is required for update action.');
      }
      payload.id = String(recordId);

      const res = await this.request<OperationResponse>(`${endpoint}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        message: res.message || `${input.recordType} record updated successfully`,
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    throw new Error(`Unsupported manageRecords action: ${(input as any).action}`);
  }

  async manageReminders(input: ManageRemindersInput): Promise<ResourceFacadeResult> {
    if (input.action === 'delete') {
      const reminderId = input.id ?? input.reminderId;
      if (!reminderId) {
        throw new Error('Reminder id is required for delete action.');
      }
      const res = await this.request<OperationResponse>(
        `/api/vehicle/reminders/delete?id=${reminderId}`,
        { method: 'DELETE' },
      );
      return {
        success: true,
        message: res.message || `Reminder #${reminderId} deleted successfully`,
        data: { id: Number(reminderId) },
      };
    }

    const vehicles = await this.listVehicles();
    let resolvedVehicleId: number | undefined;
    let resolvedVehicleName: string | undefined;

    const vehicleTarget = input.vehicle ?? input.vehicleId;
    if (vehicleTarget !== undefined) {
      const resolved = resolveVehicle(vehicleTarget, vehicles);
      resolvedVehicleId = resolved.id;
      resolvedVehicleName = resolved.name;
    }

    const tagsFormatted = Array.isArray(input.tags)
      ? input.tags.join(' ')
      : input.tags ?? '';

    const payload = {
      id: input.id ? String(input.id) : undefined,
      vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
      description: input.description ?? 'Scheduled Reminder',
      urgency: input.urgency ?? 'NotUrgent',
      metric: input.metric ?? 'Date',
      dueDate: input.dueDate ?? '',
      dueOdometer: input.dueOdometer != null ? String(input.dueOdometer) : '',
      notes: input.notes ?? '',
      tags: tagsFormatted,
    };

    if (input.action === 'create') {
      if (!resolvedVehicleId) {
        throw new Error('Vehicle must be specified when creating a reminder.');
      }
      const res = await this.request<OperationResponse>('/api/vehicle/reminders/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Reminder created successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    if (input.action === 'update') {
      const reminderId = input.id ?? input.reminderId;
      if (!reminderId) {
        throw new Error('Reminder id is required for update action.');
      }
      payload.id = String(reminderId);

      const res = await this.request<OperationResponse>('/api/vehicle/reminders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Reminder updated successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    throw new Error(`Unsupported manageReminders action: ${(input as any).action}`);
  }

  async managePlans(input: ManagePlansInput): Promise<ResourceFacadeResult> {
    if (input.action === 'delete') {
      const planId = input.id ?? input.planId;
      if (!planId) {
        throw new Error('Plan id is required for delete action.');
      }
      const res = await this.request<OperationResponse>(
        `/api/vehicle/planrecords/delete?id=${planId}`,
        { method: 'DELETE' },
      );
      return {
        success: true,
        message: res.message || `Plan record #${planId} deleted successfully`,
        data: { id: Number(planId) },
      };
    }

    const vehicles = await this.listVehicles();
    let resolvedVehicleId: number | undefined;
    let resolvedVehicleName: string | undefined;

    const vehicleTarget = input.vehicle ?? input.vehicleId;
    if (vehicleTarget !== undefined) {
      const resolved = resolveVehicle(vehicleTarget, vehicles);
      resolvedVehicleId = resolved.id;
      resolvedVehicleName = resolved.name;
    }

    const payload = {
      id: input.id ? String(input.id) : undefined,
      vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
      description: input.description ?? 'Planned Task',
      priority: input.priority ?? 'Normal',
      progress: input.progress ?? 'Backlog',
      cost: String(input.cost ?? 0),
      notes: input.notes ?? '',
      type: input.type ?? 'ServiceRecord',
      extraFields: input.extraFields ?? [],
    };

    if (input.action === 'create') {
      if (!resolvedVehicleId) {
        throw new Error('Vehicle must be specified when creating a plan record.');
      }
      const res = await this.request<OperationResponse>('/api/vehicle/planrecords/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Plan record created successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    if (input.action === 'update') {
      const planId = input.id ?? input.planId;
      if (!planId) {
        throw new Error('Plan id is required for update action.');
      }
      payload.id = String(planId);

      const res = await this.request<OperationResponse>('/api/vehicle/planrecords/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Plan record updated successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    throw new Error(`Unsupported managePlans action: ${(input as any).action}`);
  }

  async manageSupplies(input: ManageSuppliesInput): Promise<ResourceFacadeResult> {
    if (input.action === 'delete') {
      const supplyId = input.id ?? input.supplyId;
      if (!supplyId) {
        throw new Error('Supply id is required for delete action.');
      }
      const res = await this.request<OperationResponse>(
        `/api/vehicle/supplyrecords/delete?id=${supplyId}`,
        { method: 'DELETE' },
      );
      return {
        success: true,
        message: res.message || `Supply record #${supplyId} deleted successfully`,
        data: { id: Number(supplyId) },
      };
    }

    const vehicles = await this.listVehicles();
    let resolvedVehicleId: number | undefined;
    let resolvedVehicleName: string | undefined;

    const vehicleTarget = input.vehicle ?? input.vehicleId;
    if (vehicleTarget !== undefined) {
      const resolved = resolveVehicle(vehicleTarget, vehicles);
      resolvedVehicleId = resolved.id;
      resolvedVehicleName = resolved.name;
    }

    const tagsFormatted = Array.isArray(input.tags)
      ? input.tags.join(' ')
      : input.tags ?? '';

    const payload = {
      id: input.id ? String(input.id) : undefined,
      vehicleId: resolvedVehicleId ? String(resolvedVehicleId) : undefined,
      partNumber: input.partNumber ?? '',
      partSupplier: input.partSupplier ?? '',
      partQuantity: String(input.partQuantity ?? 1),
      description: input.description ?? 'Supply Item',
      cost: String(input.cost ?? 0),
      notes: input.notes ?? '',
      tags: tagsFormatted,
      extraFields: input.extraFields ?? [],
    };

    if (input.action === 'create') {
      if (!resolvedVehicleId) {
        throw new Error('Vehicle must be specified when creating a supply record.');
      }
      const res = await this.request<OperationResponse>('/api/vehicle/supplyrecords/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Supply record created successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    if (input.action === 'update') {
      const supplyId = input.id ?? input.supplyId;
      if (!supplyId) {
        throw new Error('Supply id is required for update action.');
      }
      payload.id = String(supplyId);

      const res = await this.request<OperationResponse>('/api/vehicle/supplyrecords/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return {
        success: true,
        message: res.message || 'Supply record updated successfully',
        data: payload,
        resolved: resolvedVehicleName ? { vehicle: resolvedVehicleName } : undefined,
      };
    }

    throw new Error(`Unsupported manageSupplies action: ${(input as any).action}`);
  }

  // --- Operations ---

  async triggerReminders(params?: { urgency?: string }): Promise<{ success: boolean; message: string }> {
    const query = params?.urgency ? `?urgency=${encodeURIComponent(params.urgency)}` : '';
    const res = await this.request<OperationResponse>(`/api/vehicle/reminders/send${query}`);
    return {
      success: true,
      message: res?.message || 'Reminder check initiated',
    };
  }

  async recalculateOdometer(vehicleId: number): Promise<{ success: boolean; message: string }> {
    const res = await this.request<OperationResponse>(
      `/api/vehicle/odometerrecords/recalculate?vehicleId=${vehicleId}`,
    );
    return {
      success: true,
      message: res?.message || `Odometer recalculated for vehicle #${vehicleId}`,
    };
  }

  async createBackup(outputName?: string): Promise<{ success: boolean; message: string }> {
    const query = outputName ? `?output=${encodeURIComponent(outputName)}` : '';
    const res = await this.request<OperationResponse>(`/api/makebackup${query}`);
    return {
      success: true,
      message: res?.message || 'Backup generated successfully',
    };
  }
}

export function createLubeLoggerGateway(options: LubeLoggerGatewayOptions): LubeLoggerGateway {
  return new DefaultLubeLoggerGateway(options);
}

export { GatewayRegistry, createGatewayRegistry } from './gatewayRegistry.js';

export async function verifyLubeLoggerCredentials(
  serverUrl: string,
  credentials: UserCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedUrl = serverUrl.replace(/\/+$/, '');
  const headers = buildAuthHeaders(credentials);

  if (!credentials.apiKey && (!credentials.username || !credentials.password)) {
    return { valid: false, error: 'No credentials provided' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetchFn(`${normalizedUrl}/api/vehicles`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 200) {
      return { valid: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Invalid credentials. LubeLogger rejected the login.' };
    }
    return { valid: false, error: `LubeLogger returned HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { valid: false, error: `Connection to LubeLogger timed out at ${normalizedUrl}` };
    }
    return {
      valid: false,
      error: `Could not connect to LubeLogger (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
