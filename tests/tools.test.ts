import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { LubeLoggerGateway } from '../src/gateway/types.js';
import { issueBearerToken } from './helpers/auth.js';

describe('MCP Tools Suite', () => {
  let tmpDataDir: string;
  let config: AppConfig;
  let mockGateway: LubeLoggerGateway;
  let app: Express;
  let token: string;

  beforeEach(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubelogger-tools-test-'));

    config = {
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: 3000,
      DATA_DIR: tmpDataDir,
      OAUTH_ALLOWED_REDIRECT_URIS: ['http://localhost'],
      LUBELOGGER_URL: 'http://localhost:8383',
      LUBELOGGER_API_KEY: 'test-key',
      CACHE_TTL_SECONDS: 30,
      MCP_RATE_LIMIT_WINDOW_MS: 60000,
      MCP_RATE_LIMIT_MAX: 120,
    };

    mockGateway = {
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      getReadiness: vi.fn(() => ({
        ready: true,
        lastCheckedAt: '2026-11-11T12:00:00Z',
        serverUrl: 'http://localhost:8383',
      })),
      getServerInfo: vi.fn(async () => ({ version: '1.4.6' })),
      getServerVersion: vi.fn(async () => ({ version: '1.4.6' })),
      getHealth: vi.fn(async () => ({ status: 'healthy', healthy: true })),
      listVehicles: vi.fn(async () => [
        {
          id: 1,
          year: 2020,
          make: 'Toyota',
          model: 'Corolla',
          licensePlate: 'COR-001',
          fuelType: 'Gasoline',
        },
      ]),
      getVehicleInfo: vi.fn(async () => ({
        vehicleData: { id: 1, year: 2020, make: 'Toyota', model: 'Corolla' } as any,
        lastReportedOdometer: 35000,
        serviceRecordCount: 3,
        serviceRecordCost: 150,
        repairRecordCount: 0,
        repairRecordCost: 0,
        upgradeRecordCount: 0,
        upgradeRecordCost: 0,
        gasRecordCount: 12,
        gasRecordCost: 400,
        taxRecordCount: 1,
        taxRecordCost: 60,
        veryUrgentReminderCount: 0,
        urgentReminderCount: 1,
        notUrgentReminderCount: 0,
        pastDueReminderCount: 0,
      })),
      getAdjustedOdometer: vi.fn(async () => ({ adjustedOdometer: 35000 })),
      getRecords: vi.fn(async () => [
        { id: 10, description: 'Oil and filter change', cost: 45 },
      ]),
      getMaintenanceSummary: vi.fn(async () => ({
        vehicleId: 1,
        vehicleName: '2020 Toyota Corolla (COR-001)',
        totalCost: 610,
        serviceCost: 150,
        repairCost: 0,
        upgradeCost: 0,
        gasCost: 400,
        taxCost: 60,
        totalRecordsCount: 16,
        pendingRemindersCount: 1,
        urgentRemindersCount: 1,
      })),
      listReminders: vi.fn(async () => [
        { id: 5, vehicleId: 1, description: 'Tire rotation', urgency: 'Urgent', metric: 'Odometer' },
      ]),
      getExtraFields: vi.fn(async () => [
        { recordType: 'ServiceRecord', extraFields: [{ name: 'Technician', value: '' }] },
      ]),
      manageVehicles: vi.fn(async (input) => ({
        success: true,
        message: `Vehicle ${input.action}d`,
        data: input,
      })),
      manageRecords: vi.fn(async (input) => ({
        success: true,
        message: `${input.recordType} ${input.action}d`,
        data: input,
      })),
      manageReminders: vi.fn(async (input) => ({
        success: true,
        message: `Reminder ${input.action}d`,
        data: input,
      })),
      managePlans: vi.fn(async (input) => ({
        success: true,
        message: `Plan ${input.action}d`,
        data: input,
      })),
      manageSupplies: vi.fn(async (input) => ({
        success: true,
        message: `Supply ${input.action}d`,
        data: input,
      })),
      triggerReminders: vi.fn(async () => ({
        success: true,
        message: 'Reminder notification emails sent',
      })),
      recalculateOdometer: vi.fn(async (vehicleId) => ({
        success: true,
        message: `Odometer recalculated for vehicle ${vehicleId}`,
      })),
      createBackup: vi.fn(async () => ({
        success: true,
        message: 'Backup created successfully',
      })),
    };

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = (init?.headers as Record<string, string>) || {};
      if (urlStr.includes('/api/vehicles')) {
        if (headers['x-api-key'] === 'valid-user-api-key') {
          return new Response(JSON.stringify([{ id: 1, year: 2020, make: 'Subaru', model: 'Outback' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    app = createApp({ config, gateway: mockGateway, fetchFn: mockFetch as any });
    token = await issueBearerToken(app);
  });

  afterEach(() => {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  async function callMcpTool(name: string, args: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
        id: Math.floor(Math.random() * 10000),
      });
    return res;
  }

  it('runs get_server_info', async () => {
    const res = await callMcpTool('get_server_info');
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.version.version).toBe('1.4.6');
  });

  it('runs get_vehicle_info with resolved name', async () => {
    const res = await callMcpTool('get_vehicle_info', { vehicle: 'Corolla' });
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.vehicleId).toBe(1);
    expect(text.serviceRecordCount).toBe(3);
  });

  it('runs get_records for gas with date filters', async () => {
    const res = await callMcpTool('get_records', {
      recordType: 'gas',
      vehicle: 'Corolla',
      startDate: '2026-01-01',
    });
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.recordType).toBe('gas');
    expect(text.records).toHaveLength(1);
  });

  it('runs get_maintenance_summary for garage', async () => {
    const res = await callMcpTool('get_maintenance_summary');
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.totalCost).toBe(610);
  });

  it('runs list_reminders with urgency filter', async () => {
    const res = await callMcpTool('list_reminders', { urgency: 'Urgent' });
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.reminders).toHaveLength(1);
  });

  it('runs get_extra_fields', async () => {
    const res = await callMcpTool('get_extra_fields');
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.extraFields).toHaveLength(1);
  });

  it('executes manage_vehicles create action', async () => {
    const res = await callMcpTool('manage_vehicles', {
      action: 'create',
      year: 2024,
      make: 'Mazda',
      model: 'CX-5',
    });
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.success).toBe(true);
  });

  it('executes manage_records create action with in-process vehicle resolution', async () => {
    const res = await callMcpTool('manage_records', {
      recordType: 'service',
      action: 'create',
      vehicle: 'Corolla',
      description: 'Air filter change',
      cost: 25,
      odometer: 36000,
    });
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.success).toBe(true);
  });

  it('returns formatted error envelope when vehicle resolution fails in manage_records', async () => {
    const { ResolutionError } = await import('../src/gateway/resolver.js');
    mockGateway.manageRecords = vi.fn().mockRejectedValueOnce(
      new ResolutionError('UnknownCarNonExistent', 'vehicle', ['Corolla']),
    );

    const res = await callMcpTool('manage_records', {
      recordType: 'service',
      action: 'create',
      vehicle: 'UnknownCarNonExistent',
      description: 'Filter change',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    const text = JSON.parse(res.body.result.content[0].text);
    expect(text.success).toBe(false);
    expect(text.error).toBe('RESOLUTION_ERROR');
    expect(text.suggestions).toEqual(['Corolla']);
  });

  it('executes manage_reminders, manage_plans, and manage_supplies', async () => {
    const reminderRes = await callMcpTool('manage_reminders', {
      action: 'create',
      vehicle: 1,
      description: 'Check brake fluid',
      urgency: 'NotUrgent',
      metric: 'Date',
      dueDate: '2026-12-01',
    });
    expect(reminderRes.status).toBe(200);

    const planRes = await callMcpTool('manage_plans', {
      action: 'create',
      vehicle: 1,
      description: 'Ceramic tint',
      priority: 'Low',
      progress: 'Backlog',
      cost: 300,
    });
    expect(planRes.status).toBe(200);

    const supplyRes = await callMcpTool('manage_supplies', {
      action: 'create',
      vehicle: 1,
      partNumber: 'OIL-5W30',
      partQuantity: 5,
      description: 'Synthetic Oil Quart',
      cost: 35,
    });
    expect(supplyRes.status).toBe(200);
  });

  it('executes operational tools: trigger_reminders, recalculate_odometer, and create_backup', async () => {
    const reminderRes = await callMcpTool('trigger_reminders', { urgency: 'Urgent' });
    expect(reminderRes.status).toBe(200);

    const odoRes = await callMcpTool('recalculate_odometer', { vehicle: 'Corolla' });
    expect(odoRes.status).toBe(200);
    const odoText = JSON.parse(odoRes.body.result.content[0].text);
    expect(odoText.vehicleId).toBe(1);

    const backupRes = await callMcpTool('create_backup', { outputName: 'weekly-backup.zip' });
    expect(backupRes.status).toBe(200);
  });
});
