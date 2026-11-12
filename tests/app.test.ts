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

describe('App & MCP Endpoints', () => {
  let tmpDataDir: string;
  let config: AppConfig;
  let mockGateway: LubeLoggerGateway;
  let app: Express;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubelogger-app-test-'));

    config = {
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: 3000,
      DATA_DIR: tmpDataDir,
      OAUTH_ALLOWED_REDIRECT_URIS: ['http://localhost'],
      LUBELOGGER_URL: 'http://localhost:8383',
      LUBELOGGER_API_KEY: 'test-key',
      CACHE_TTL_SECONDS: 30,
    };

    mockGateway = {
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      getReadiness: vi.fn(() => ({
        ready: true,
        lastCheckedAt: '2026-11-11T12:00:00Z',
        serverUrl: 'http://localhost:8383',
        serverVersion: '1.4.6',
      })),
      getServerInfo: vi.fn(async () => ({ instance: 'demo' })),
      getServerVersion: vi.fn(async () => ({ version: '1.4.6' })),
      getHealth: vi.fn(async () => ({ status: 'healthy', healthy: true })),
      listVehicles: vi.fn(async () => [
        {
          id: 1,
          year: 2020,
          make: 'Subaru',
          model: 'Outback',
          licensePlate: 'SUB-123',
          fuelType: 'Gasoline',
        },
      ]),
      getVehicleInfo: vi.fn(async () => ({
        vehicleData: {
          id: 1,
          year: 2020,
          make: 'Subaru',
          model: 'Outback',
          licensePlate: 'SUB-123',
        },
        lastReportedOdometer: 45000,
        serviceRecordCount: 2,
        serviceRecordCost: 120,
        repairRecordCount: 0,
        repairRecordCost: 0,
        upgradeRecordCount: 0,
        upgradeRecordCost: 0,
        gasRecordCount: 5,
        gasRecordCost: 200,
        taxRecordCount: 1,
        taxRecordCost: 50,
        veryUrgentReminderCount: 0,
        urgentReminderCount: 0,
        notUrgentReminderCount: 1,
        pastDueReminderCount: 0,
      })),
      getAdjustedOdometer: vi.fn(async () => ({ adjustedOdometer: 45000 })),
      getRecords: vi.fn(async () => []),
      getMaintenanceSummary: vi.fn(async () => ({
        vehicleName: 'Subaru Outback',
        totalCost: 370,
        serviceCost: 120,
        repairCost: 0,
        upgradeCost: 0,
        gasCost: 200,
        taxCost: 50,
        totalRecordsCount: 8,
        pendingRemindersCount: 1,
        urgentRemindersCount: 0,
      })),
      listReminders: vi.fn(async () => []),
      getExtraFields: vi.fn(async () => []),
      manageVehicles: vi.fn(async () => ({ success: true, message: 'Vehicle managed', data: {} })),
      manageRecords: vi.fn(async () => ({ success: true, message: 'Record managed', data: {} })),
      manageReminders: vi.fn(async () => ({ success: true, message: 'Reminder managed', data: {} })),
      managePlans: vi.fn(async () => ({ success: true, message: 'Plan managed', data: {} })),
      manageSupplies: vi.fn(async () => ({ success: true, message: 'Supply managed', data: {} })),
      triggerReminders: vi.fn(async () => ({ success: true, message: 'ok' })),
      recalculateOdometer: vi.fn(async () => ({ success: true, message: 'ok' })),
      createBackup: vi.fn(async () => ({ success: true, message: 'ok' })),
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
  });

  afterEach(() => {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('sets secure HTTP response headers', async () => {
    const res = await request(app)
      .get('/healthz')
      .set('Host', 'mcp.example.com');

    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects unauthorized Host headers', async () => {
    const res = await request(app)
      .get('/healthz')
      .set('Host', 'evil-attacker.com');

    expect(res.status).toBe(403);
  });

  it('serves /healthz with server readiness details', async () => {
    const res = await request(app)
      .get('/healthz')
      .set('Host', 'mcp.example.com');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.lubeLogger.ready).toBe(true);
    expect(res.body.lubeLogger.serverVersion).toBe('1.4.6');
  });

  it('serves brand assets', async () => {
    const logoRes = await request(app)
      .get('/logo.svg')
      .set('Host', 'mcp.example.com');
    expect(logoRes.status).toBe(200);
    expect(logoRes.headers['content-type']).toContain('image/svg+xml');
    const logoText = logoRes.text || logoRes.body.toString('utf8');
    expect(logoText).toContain('LubeLogger MCP Logo');

    const logoDarkRes = await request(app)
      .get('/logo-dark.svg')
      .set('Host', 'mcp.example.com');
    expect(logoDarkRes.status).toBe(200);
    expect(logoDarkRes.headers['content-type']).toContain('image/svg+xml');
    const logoDarkText = logoDarkRes.text || logoDarkRes.body.toString('utf8');
    expect(logoDarkText).toContain('LubeLogger MCP Logo (Dark Mode)');

    const symbolRes = await request(app)
      .get('/logo-symbol.svg')
      .set('Host', 'mcp.example.com');
    expect(symbolRes.status).toBe(200);
    expect(symbolRes.headers['content-type']).toContain('image/svg+xml');
    const symbolText = symbolRes.text || symbolRes.body.toString('utf8');
    expect(symbolText).toContain('LubeLogger MCP - Neural Wheel Mark');

    const logoPngRes = await request(app)
      .get('/logo.png')
      .set('Host', 'mcp.example.com');
    expect(logoPngRes.status).toBe(200);

    const favRes = await request(app)
      .get('/favicon.ico')
      .set('Host', 'mcp.example.com');
    expect(favRes.status).toBe(200);
  });

  it('returns 401 on /mcp without bearer token', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .send({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });

    expect(res.status).toBe(401);
  });

  it('returns 405 on GET and DELETE /mcp', async () => {
    const getRes = await request(app)
      .get('/mcp')
      .set('Host', 'mcp.example.com');
    expect(getRes.status).toBe(405);
    expect(getRes.body.error.code).toBe(-32000);

    const deleteRes = await request(app)
      .delete('/mcp')
      .set('Host', 'mcp.example.com');
    expect(deleteRes.status).toBe(405);
    expect(deleteRes.body.error.code).toBe(-32000);
  });

  it('processes MCP initialize and tools/list requests with valid bearer token', async () => {
    const token = await issueBearerToken(app);

    // 1. Initialize
    const initRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        id: 1,
      });

    expect(initRes.status).toBe(200);
    expect(initRes.body.result.serverInfo.name).toBe('lubelogger-mcp');

    // 2. Tools list
    const toolsRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2,
      });

    expect(toolsRes.status).toBe(200);
    const toolNames = toolsRes.body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('list_vehicles');
    expect(toolNames).toContain('get_vehicle_info');
    expect(toolNames).toContain('get_records');
    expect(toolNames).toContain('get_maintenance_summary');
    expect(toolNames).toContain('list_reminders');
    expect(toolNames).toContain('manage_vehicles');
    expect(toolNames).toContain('manage_records');
    expect(toolNames).toContain('manage_reminders');
    expect(toolNames).toContain('manage_plans');
    expect(toolNames).toContain('manage_supplies');
    expect(toolNames).toContain('trigger_reminders');
    expect(toolNames).toContain('recalculate_odometer');
    expect(toolNames).toContain('create_backup');
  });

  it('calls MCP tool list_vehicles and receives vehicle records', async () => {
    const token = await issueBearerToken(app);

    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_vehicles',
          arguments: {},
        },
        id: 3,
      });

    expect(res.status).toBe(200);
    const textContent = JSON.parse(res.body.result.content[0].text);
    expect(textContent.count).toBe(1);
    expect(textContent.vehicles[0].model).toBe('Outback');
  });
});
