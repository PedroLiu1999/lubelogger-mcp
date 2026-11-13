import { describe, expect, it, vi } from 'vitest';
import { createGatewayRegistry } from '../src/gateway/gatewayRegistry.js';
import { DefaultLubeLoggerGateway } from '../src/gateway/lubeLoggerGateway.js';

describe('LubeLoggerGateway', () => {
  const mockVehicles = [
    {
      id: 1,
      year: 2020,
      make: 'Subaru',
      model: 'Outback',
      licensePlate: 'SUB-123',
      fuelType: 'Gasoline',
      tags: ['daily'],
    },
    {
      id: 2,
      year: 2021,
      make: 'Ford',
      model: 'F-150',
      licensePlate: 'TRK-999',
      fuelType: 'Gasoline',
    },
  ];

  it('sends x-api-key and culture-invariant headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(mockVehicles), { status: 200 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'my-secret-key',
      fetchFn: mockFetch as any,
    });

    const vehicles = await gateway.listVehicles();
    expect(vehicles).toHaveLength(2);
    expect(capturedHeaders?.['x-api-key']).toBe('my-secret-key');
    expect(capturedHeaders?.['culture-invariant']).toBe('true');
  });

  it('sends Basic Auth header when username and password are provided', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(mockVehicles), { status: 200 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      username: 'user1',
      password: 'secretpassword',
      fetchFn: mockFetch as any,
    });

    await gateway.listVehicles();
    const expectedAuth = `Basic ${Buffer.from('user1:secretpassword').toString('base64')}`;
    expect(capturedHeaders?.['Authorization']).toBe(expectedAuth);
  });

  it('caches vehicles and refreshes when forceSync is true', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify(mockVehicles), { status: 200 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'key',
      cacheTtlSeconds: 60,
      fetchFn: mockFetch as any,
    });

    await gateway.listVehicles();
    expect(callCount).toBe(1);

    // Second call without forceSync uses cache
    await gateway.listVehicles();
    expect(callCount).toBe(1);

    // Call with forceSync triggers fetch
    await gateway.listVehicles({ forceSync: true });
    expect(callCount).toBe(2);
  });

  it('fetches vehicle info and calculates maintenance summary', async () => {
    const mockInfo = {
      vehicleData: mockVehicles[0],
      lastReportedOdometer: 45000,
      serviceRecordCount: 3,
      serviceRecordCost: 150.50,
      repairRecordCount: 1,
      repairRecordCost: 200.00,
      upgradeRecordCount: 0,
      upgradeRecordCost: 0,
      gasRecordCount: 10,
      gasRecordCost: 450.00,
      taxRecordCount: 1,
      taxRecordCost: 75.00,
      veryUrgentReminderCount: 1,
      urgentReminderCount: 0,
      notUrgentReminderCount: 2,
      pastDueReminderCount: 0,
    };

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/vehicles')) {
        return new Response(JSON.stringify(mockVehicles), { status: 200 });
      }
      if (urlStr.includes('/api/vehicle/info')) {
        return new Response(JSON.stringify(mockInfo), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const summary = await gateway.getMaintenanceSummary(1);
    expect(summary.vehicleId).toBe(1);
    expect(summary.totalCost).toBe(150.50 + 200.00 + 450.00 + 75.00);
    expect(summary.serviceCost).toBe(150.50);
    expect(summary.urgentRemindersCount).toBe(1);
  });

  it('queries records with filters and resolves vehicle name', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      requestedUrl = url.toString();
      if (requestedUrl.includes('/api/vehicles')) {
        return new Response(JSON.stringify(mockVehicles), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: 101, description: 'Oil Change', cost: 55 }]), { status: 200 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const records = await gateway.getRecords('service', {
      vehicle: 'Subaru Outback',
      startDate: '2026-01-01',
      limit: 10,
    });

    expect(records).toHaveLength(1);
    expect(requestedUrl).toContain('vehicleId=1');
    expect(requestedUrl).toContain('startDate=2026-01-01');
  });

  it('handles record mutation facades (create, update, delete)', async () => {
    let lastMethod = '';
    let lastUrl = '';
    let lastBody = '';

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      lastMethod = init?.method ?? 'GET';
      lastUrl = url.toString();
      lastBody = init?.body ? String(init.body) : '';

      if (lastUrl.includes('/api/vehicles')) {
        return new Response(JSON.stringify(mockVehicles), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, message: 'Success' }), { status: 200 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    // Create record
    const createRes = await gateway.manageRecords({
      recordType: 'service',
      action: 'create',
      vehicle: 1,
      description: 'Brake pads replacement',
      cost: 180,
      odometer: 48000,
    });
    expect(createRes.success).toBe(true);
    expect(lastMethod).toBe('POST');
    expect(lastUrl).toContain('/api/vehicle/servicerecords/add');
    expect(lastBody).toContain('Brake pads replacement');

    // Update record
    const updateRes = await gateway.manageRecords({
      recordType: 'service',
      action: 'update',
      id: 55,
      description: 'Updated brake pads replacement',
      cost: 200,
    });
    expect(updateRes.success).toBe(true);
    expect(lastMethod).toBe('PUT');
    expect(lastUrl).toContain('/api/vehicle/servicerecords/update');

    // Delete record
    const deleteRes = await gateway.manageRecords({
      recordType: 'service',
      action: 'delete',
      id: 55,
    });
    expect(deleteRes.success).toBe(true);
    expect(lastMethod).toBe('DELETE');
    expect(lastUrl).toContain('/api/vehicle/servicerecords/delete?id=55');
  });

  it('throws descriptive error on authentication failure (401)', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'wrong-key',
      fetchFn: mockFetch as any,
    });

    await expect(gateway.listVehicles()).rejects.toThrow(/LubeLogger authentication failed/);
  });

  it('marks readiness as dynamic-auth ready on 401 probe when secret-free', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      fetchFn: mockFetch as any,
    });

    await gateway.initialize();
    const readiness = gateway.getReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.serverVersion).toBe('dynamic-auth');
  });

  it('GatewayRegistry reuses cached gateway instance across requests with same credentials', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify(mockVehicles), { status: 200 });
    });

    const registry = createGatewayRegistry({
      serverUrl: 'http://test-lubelogger:8383',
      fetchFn: mockFetch as any,
    });

    const gw1 = registry.getGateway({ apiKey: 'user-key-1' });
    const gw2 = registry.getGateway({ apiKey: 'user-key-1' });
    const gwOther = registry.getGateway({ apiKey: 'user-key-2' });
    const gwDefault = registry.getGateway();

    // Reuses same instance for same key
    expect(gw1).toBe(gw2);
    // Distinct instances for different keys
    expect(gw1).not.toBe(gwOther);
    expect(gw1).not.toBe(gwDefault);

    await registry.shutdown();
  });

  it('recalculateOdometer sends HTTP PUT to LubeLogger and handles success', async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      capturedUrl = url.toString();
      if (capturedMethod !== 'PUT') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return new Response(JSON.stringify({ success: true, message: 'Odometer Records Adjusted(5)' }), {
        status: 200,
      });
    });

    const gateway = new DefaultLubeLoggerGateway({
      serverUrl: 'http://test-lubelogger:8383',
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const result = await gateway.recalculateOdometer(1);
    expect(result.success).toBe(true);
    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toContain('/api/vehicle/odometerrecords/recalculate?vehicleId=1');
  });
});
