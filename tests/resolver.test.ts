import { describe, expect, it } from 'vitest';
import {
  AmbiguityError,
  createResourceFacadeErrorResponse,
  findVehicleSuggestions,
  formatVehicleDisplayName,
  ResolutionError,
  resolveVehicle,
} from '../src/gateway/resolver.js';
import type { Vehicle } from '../src/gateway/types.js';

describe('Resolver', () => {
  const sampleVehicles: Vehicle[] = [
    {
      id: 1,
      year: 2019,
      make: 'Honda',
      model: 'Civic',
      licensePlate: 'ABC-1234',
      fuelType: 'Gasoline',
    },
    {
      id: 2,
      year: 2022,
      make: 'Toyota',
      model: 'RAV4 Hybrid',
      licensePlate: 'XYZ-9876',
      fuelType: 'Hybrid',
    },
    {
      id: 3,
      year: 2023,
      make: 'Tesla',
      model: 'Model Y',
      licensePlate: 'EV-555',
      fuelType: 'Electric',
      isElectric: true,
    },
    {
      id: 4,
      year: 2015,
      make: 'Honda',
      model: 'Accord',
      licensePlate: 'HND-444',
      fuelType: 'Gasoline',
    },
  ];

  it('formats display name correctly with year, make, model and license plate', () => {
    expect(formatVehicleDisplayName(sampleVehicles[0]!)).toBe('2019 Honda Civic (ABC-1234)');
    expect(formatVehicleDisplayName({ id: 5, model: 'Beater' })).toBe('Beater');
    expect(formatVehicleDisplayName({ id: 6 })).toBe('Vehicle #6');
  });

  it('resolves vehicle by numeric ID', () => {
    const res1 = resolveVehicle(1, sampleVehicles);
    expect(res1.id).toBe(1);
    expect(res1.matchedBy).toBe('id');

    const res2 = resolveVehicle('2', sampleVehicles);
    expect(res2.id).toBe(2);
    expect(res2.matchedBy).toBe('id');
  });

  it('resolves vehicle by exact license plate (case-insensitive)', () => {
    const res = resolveVehicle('abc-1234', sampleVehicles);
    expect(res.id).toBe(1);
    expect(res.matchedBy).toBe('licensePlate');
  });

  it('resolves vehicle by full name', () => {
    const res = resolveVehicle('2022 Toyota RAV4 Hybrid', sampleVehicles);
    expect(res.id).toBe(2);
    expect(res.matchedBy).toBe('exactName');
  });

  it('resolves vehicle by unique substring', () => {
    const res = resolveVehicle('RAV4', sampleVehicles);
    expect(res.id).toBe(2);
    expect(res.matchedBy).toBe('partialName');
  });

  it('throws AmbiguityError when multiple vehicles match a query', () => {
    expect(() => resolveVehicle('Honda', sampleVehicles)).toThrow(AmbiguityError);
  });

  it('provides fuzzy suggestions on typos', () => {
    const suggestions = findVehicleSuggestions('Civik', sampleVehicles);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]).toContain('Civic');

    expect(() => resolveVehicle('Civik', sampleVehicles)).toThrow(ResolutionError);
  });

  it('formats error responses cleanly in createResourceFacadeErrorResponse', () => {
    const resErr = new ResolutionError('Tessla', 'vehicle', ['Tesla Model Y']);
    const formattedRes = createResourceFacadeErrorResponse(resErr);
    expect(formattedRes.success).toBe(false);
    expect(formattedRes.error).toBe('RESOLUTION_ERROR');
    expect(formattedRes.suggestions).toEqual(['Tesla Model Y']);

    const ambErr = new AmbiguityError('Honda', 'vehicle', ['Civic', 'Accord']);
    const formattedAmb = createResourceFacadeErrorResponse(ambErr);
    expect(formattedAmb.success).toBe(false);
    expect(formattedAmb.error).toBe('AMBIGUITY_ERROR');

    const generic = createResourceFacadeErrorResponse(new Error('Network timeout'));
    expect(generic.success).toBe(false);
    expect(generic.error).toBe('OPERATION_FAILED');
    expect(generic.message).toBe('Network timeout');
  });
});
