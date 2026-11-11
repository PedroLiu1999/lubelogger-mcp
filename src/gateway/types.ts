export interface ExtraField {
  id?: number | string;
  name: string;
  value: string;
}

export interface UploadedFile {
  name: string;
  location: string;
}

export interface Vehicle {
  id: number;
  year: number;
  make: string;
  model: string;
  licensePlate: string;
  soldDate?: string;
  isSold?: boolean;
  isElectric?: boolean;
  useEngineHours?: boolean;
  odometerOptional?: boolean;
  fuelType?: string;
  tags?: string[];
  extraFields?: ExtraField[];
}

export interface VehicleInfo {
  vehicleData: Vehicle;
  lastReportedOdometer: number;
  serviceRecordCount: number;
  serviceRecordCost: number;
  repairRecordCount: number;
  repairRecordCost: number;
  upgradeRecordCount: number;
  upgradeRecordCost: number;
  gasRecordCount: number;
  gasRecordCost: number;
  taxRecordCount: number;
  taxRecordCost: number;
  veryUrgentReminderCount: number;
  urgentReminderCount: number;
  notUrgentReminderCount: number;
  pastDueReminderCount: number;
  nextReminder?: ReminderRecord;
  planRecordBackLogCount?: number;
  planRecordInProgressCount?: number;
  planRecordTestingCount?: number;
  planRecordDoneCount?: number;
}

export interface GenericRecord {
  id: number;
  vehicleId: number;
  date: string;
  odometer: number;
  description: string;
  cost: number;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface GasRecord {
  id: number;
  vehicleId: number;
  date: string;
  odometer: number;
  fuelConsumed: number;
  cost: number;
  fuelEconomy?: number;
  isFillToFull?: boolean;
  missedFuelUp?: boolean;
  startingSoc?: number;
  endingSoc?: number;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface OdometerRecord {
  id: number;
  vehicleId: number;
  date: string;
  initialOdometer?: number;
  odometer: number;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface ReminderRecord {
  id: number;
  vehicleId: number;
  description: string;
  urgency: 'NotUrgent' | 'Urgent' | 'VeryUrgent' | string;
  metric: 'Date' | 'Odometer' | 'Both' | string;
  userMetric?: string;
  notes?: string;
  dueDate?: string;
  dueOdometer?: number;
  dueDays?: number;
  dueDistance?: number;
  tags?: string[];
}

export interface TaxRecord {
  id: number;
  vehicleId: number;
  date: string;
  description: string;
  cost: number;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface NoteRecord {
  id: number;
  vehicleId: number;
  description: string;
  noteText: string;
  pinned?: boolean;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface PlanRecord {
  id: number;
  vehicleId: number;
  dateCreated?: string;
  dateModified?: string;
  description: string;
  notes?: string;
  type?: string;
  priority: 'Critical' | 'Normal' | 'Low' | string;
  progress: 'Backlog' | 'InProgress' | 'Testing' | 'Done' | string;
  cost: number;
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface SupplyRecord {
  id: number;
  vehicleId: number;
  date?: string;
  partNumber: string;
  partSupplier?: string;
  partQuantity: number;
  description: string;
  cost: number;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export interface EquipmentRecord {
  id: number;
  vehicleId: number;
  description: string;
  notes?: string;
  tags?: string[];
  extraFields?: ExtraField[];
  files?: UploadedFile[];
}

export type SupportedRecordType =
  | 'service'
  | 'repair'
  | 'upgrade'
  | 'gas'
  | 'odometer'
  | 'tax'
  | 'note'
  | 'reminder'
  | 'plan'
  | 'supply'
  | 'equipment';

export interface QueryRecordsFilter {
  vehicle?: string | number;
  vehicleId?: number;
  startDate?: string;
  endDate?: string;
  tags?: string;
  limit?: number;
  forceSync?: boolean;
}

export interface MaintenanceSummary {
  vehicleId?: number;
  vehicleName?: string;
  totalCost: number;
  serviceCost: number;
  repairCost: number;
  upgradeCost: number;
  gasCost: number;
  taxCost: number;
  totalRecordsCount: number;
  lastReportedOdometer?: number;
  pendingRemindersCount: number;
  urgentRemindersCount: number;
  recentRecords?: Array<{
    type: string;
    date: string;
    description: string;
    cost?: number;
  }>;
}

export interface ManageVehiclesInput {
  action: 'create' | 'update' | 'delete';
  id?: number | string;
  vehicle?: string;
  vehicleId?: number;
  year?: number;
  make?: string;
  model?: string;
  licensePlate?: string;
  fuelType?: string;
  isElectric?: boolean;
  tags?: string[] | string;
  extraFields?: ExtraField[];
}

export interface ManageRecordsInput {
  recordType: 'service' | 'repair' | 'upgrade' | 'gas' | 'tax' | 'note' | 'odometer';
  action: 'create' | 'update' | 'delete';
  vehicle?: string | number;
  vehicleId?: number;
  id?: number | string;
  recordId?: number | string;
  date?: string;
  odometer?: number;
  description?: string;
  cost?: number;
  notes?: string;
  tags?: string[] | string;
  // Gas specific
  fuelConsumed?: number;
  fuelEconomy?: number;
  isFillToFull?: boolean;
  missedFuelUp?: boolean;
  startingSoc?: number;
  endingSoc?: number;
  // Note specific
  noteText?: string;
  pinned?: boolean;
  // Odometer specific
  initialOdometer?: number;
  extraFields?: ExtraField[];
}

export interface ManageRemindersInput {
  action: 'create' | 'update' | 'delete';
  vehicle?: string | number;
  vehicleId?: number;
  id?: number | string;
  reminderId?: number | string;
  description?: string;
  urgency?: 'NotUrgent' | 'Urgent' | 'VeryUrgent' | string;
  metric?: 'Date' | 'Odometer' | 'Both' | string;
  dueDate?: string;
  dueOdometer?: number;
  notes?: string;
  tags?: string[] | string;
}

export interface ManagePlansInput {
  action: 'create' | 'update' | 'delete';
  vehicle?: string | number;
  vehicleId?: number;
  id?: number | string;
  planId?: number | string;
  description?: string;
  priority?: 'Critical' | 'Normal' | 'Low' | string;
  progress?: 'Backlog' | 'InProgress' | 'Testing' | 'Done' | string;
  cost?: number;
  notes?: string;
  type?: string;
  extraFields?: ExtraField[];
}

export interface ManageSuppliesInput {
  action: 'create' | 'update' | 'delete';
  vehicle?: string | number;
  vehicleId?: number;
  id?: number | string;
  supplyId?: number | string;
  partNumber?: string;
  partSupplier?: string;
  partQuantity?: number;
  description?: string;
  cost?: number;
  notes?: string;
  tags?: string[] | string;
  extraFields?: ExtraField[];
}

export interface ServerReadiness {
  ready: boolean;
  lastCheckedAt: string | null;
  serverUrl: string;
  serverVersion?: string;
  error?: string;
}

export interface LubeLoggerGateway {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getReadiness(): ServerReadiness;

  // Server metadata
  getServerInfo(): Promise<Record<string, unknown>>;
  getServerVersion(checkForUpdate?: boolean): Promise<{ version: string; isLatest?: boolean }>;
  getHealth(): Promise<{ status: string; healthy: boolean }>;

  // Vehicles
  listVehicles(options?: { forceSync?: boolean }): Promise<Vehicle[]>;
  getVehicleInfo(vehicleId: number, options?: { forceSync?: boolean }): Promise<VehicleInfo>;
  getAdjustedOdometer(vehicleId: number, odometer: number): Promise<{ adjustedOdometer: number }>;

  // Records
  getRecords(
    type: SupportedRecordType,
    filter?: QueryRecordsFilter,
  ): Promise<unknown[]>;
  getMaintenanceSummary(vehicleId?: number): Promise<MaintenanceSummary>;
  listReminders(options?: {
    vehicleId?: number;
    urgency?: string;
    forceSync?: boolean;
  }): Promise<ReminderRecord[]>;
  getExtraFields(): Promise<Array<{ recordType: string; extraFields: ExtraField[] }>>;

  // Facades
  manageVehicles(input: ManageVehiclesInput): Promise<unknown>;
  manageRecords(input: ManageRecordsInput): Promise<unknown>;
  manageReminders(input: ManageRemindersInput): Promise<unknown>;
  managePlans(input: ManagePlansInput): Promise<unknown>;
  manageSupplies(input: ManageSuppliesInput): Promise<unknown>;

  // Operations
  triggerReminders(params?: { urgency?: string }): Promise<{ success: boolean; message: string }>;
  recalculateOdometer(vehicleId: number): Promise<{ success: boolean; message: string }>;
  createBackup(outputName?: string): Promise<{ success: boolean; message: string }>;
}
