import type { Vehicle } from './types.js';

export interface ResolvableVehicleCandidate {
  id: number;
  year?: number;
  make?: string;
  model?: string;
  licensePlate?: string;
  displayName?: string;
}

export interface ResolvedVehicle {
  id: number;
  name: string;
  input: string;
  matchedBy: 'id' | 'licensePlate' | 'exactName' | 'partialName' | 'fuzzy';
  vehicle: Vehicle;
}

export interface ResourceFacadeResult<T = unknown> {
  success: true;
  message: string;
  data: T;
  resolved?: Record<string, string>;
}

export interface ResourceFacadeErrorResult {
  success: false;
  message: string;
  error: string;
  entityType?: string;
  input?: string;
  suggestions?: string[];
}

export class ResolutionError extends Error {
  public readonly input: string;
  public readonly entityType: string;
  public readonly suggestions: string[];

  constructor(input: string, entityType = 'vehicle', suggestions: string[] = []) {
    const hint =
      suggestions.length > 0
        ? ` Did you mean: ${suggestions.map((s) => `"${s}"`).join(', ')}?`
        : '';
    super(`Could not find ${entityType} matching "${input}".${hint}`);
    this.name = 'ResolutionError';
    this.input = input;
    this.entityType = entityType;
    this.suggestions = suggestions;
  }
}

export class AmbiguityError extends Error {
  public readonly input: string;
  public readonly entityType: string;
  public readonly matches: string[];

  constructor(input: string, entityType = 'vehicle', matches: string[] = []) {
    super(
      `Multiple ${entityType}s match "${input}": ${matches.join(', ')}. Please specify an exact vehicle ID or license plate.`,
    );
    this.name = 'AmbiguityError';
    this.input = input;
    this.entityType = entityType;
    this.matches = matches;
  }
}

export function formatVehicleDisplayName(v: {
  id: number;
  year?: number;
  make?: string;
  model?: string;
  licensePlate?: string;
}): string {
  const parts: string[] = [];
  if (v.year) parts.push(String(v.year));
  if (v.make) parts.push(v.make);
  if (v.model) parts.push(v.model);
  const baseName = parts.length > 0 ? parts.join(' ') : `Vehicle #${v.id}`;
  if (v.licensePlate) {
    return `${baseName} (${v.licensePlate})`;
  }
  return baseName;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j] ?? 0;
    }
  }

  return prev[b.length] ?? 0;
}

function computeCandidateSimilarity(queryLower: string, candidateLower: string): number {
  if (!queryLower || !candidateLower) return 0;
  if (queryLower === candidateLower) return 1;

  if (candidateLower.startsWith(queryLower)) {
    return 0.92 + (queryLower.length / candidateLower.length) * 0.07;
  }
  if (candidateLower.includes(queryLower)) {
    return 0.82 + (queryLower.length / candidateLower.length) * 0.09;
  }
  if (queryLower.includes(candidateLower) && candidateLower.length >= 3) {
    return 0.78 + (candidateLower.length / queryLower.length) * 0.08;
  }

  const maxLen = Math.max(queryLower.length, candidateLower.length);
  const fullDist = levenshteinDistance(queryLower, candidateLower);
  const fullSimilarity = 1 - fullDist / maxLen;

  const queryTokens = queryLower.split(/[^a-z0-9]+/).filter(Boolean);
  const candidateTokens = candidateLower.split(/[^a-z0-9]+/).filter(Boolean);
  let bestTokenSimilarity = 0;
  for (const qToken of queryTokens) {
    for (const cToken of candidateTokens) {
      const tokenMax = Math.max(qToken.length, cToken.length);
      if (tokenMax > 0) {
        const sim = 1 - levenshteinDistance(qToken, cToken) / tokenMax;
        if (sim > bestTokenSimilarity) {
          bestTokenSimilarity = sim;
        }
      }
    }
  }

  return Math.max(fullSimilarity, bestTokenSimilarity * 0.85);
}

export function findVehicleSuggestions(
  query: string,
  vehicles: ReadonlyArray<Vehicle>,
  maxSuggestions = 5,
): string[] {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return [];

  const scored: Array<{ label: string; score: number }> = [];
  const seenLabels = new Set<string>();

  for (const vehicle of vehicles) {
    const displayName = formatVehicleDisplayName(vehicle);
    const candidateTexts = [
      displayName,
      vehicle.licensePlate,
      `${vehicle.make} ${vehicle.model}`,
      vehicle.model,
    ].filter((t): t is string => Boolean(t && t.trim()));

    for (const text of candidateTexts) {
      const lower = text.toLowerCase();
      const score = computeCandidateSimilarity(queryLower, lower);
      if (score >= 0.45 && !seenLabels.has(displayName)) {
        seenLabels.add(displayName);
        scored.push({ label: `${displayName} [ID: ${vehicle.id}]`, score });
        break;
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSuggestions).map((s) => s.label);
}

export function resolveVehicle(
  input: string | number,
  vehicles: ReadonlyArray<Vehicle>,
): ResolvedVehicle {
  const rawInput = String(input).trim();
  if (!rawInput) {
    throw new ResolutionError('', 'vehicle');
  }

  // 1. Direct ID match
  const numericId = Number(rawInput);
  if (!Number.isNaN(numericId) && Number.isInteger(numericId)) {
    const match = vehicles.find((v) => v.id === numericId);
    if (match) {
      return {
        id: match.id,
        name: formatVehicleDisplayName(match),
        input: rawInput,
        matchedBy: 'id',
        vehicle: match,
      };
    }
  }

  const queryLower = rawInput.toLowerCase();

  // 2. Exact License Plate match (case-insensitive)
  const plateMatches = vehicles.filter(
    (v) => v.licensePlate && v.licensePlate.trim().toLowerCase() === queryLower,
  );
  if (plateMatches.length === 1) {
    const v = plateMatches[0]!;
    return {
      id: v.id,
      name: formatVehicleDisplayName(v),
      input: rawInput,
      matchedBy: 'licensePlate',
      vehicle: v,
    };
  }

  // 3. Exact Display Name match
  const exactNameMatches = vehicles.filter((v) => {
    const name = formatVehicleDisplayName(v).toLowerCase();
    const simpleName = `${v.year ? `${v.year} ` : ''}${v.make} ${v.model}`.trim().toLowerCase();
    return name === queryLower || simpleName === queryLower;
  });
  if (exactNameMatches.length === 1) {
    const v = exactNameMatches[0]!;
    return {
      id: v.id,
      name: formatVehicleDisplayName(v),
      input: rawInput,
      matchedBy: 'exactName',
      vehicle: v,
    };
  }

  // 4. Substring / Token matches
  const substringMatches = vehicles.filter((v) => {
    const name = formatVehicleDisplayName(v).toLowerCase();
    const simple = `${v.make} ${v.model}`.toLowerCase();
    return (
      name.includes(queryLower) ||
      simple.includes(queryLower) ||
      queryLower.includes(v.model.toLowerCase())
    );
  });

  if (substringMatches.length === 1) {
    const v = substringMatches[0]!;
    return {
      id: v.id,
      name: formatVehicleDisplayName(v),
      input: rawInput,
      matchedBy: 'partialName',
      vehicle: v,
    };
  }

  if (substringMatches.length > 1) {
    throw new AmbiguityError(
      rawInput,
      'vehicle',
      substringMatches.map((v) => `${formatVehicleDisplayName(v)} [ID: ${v.id}]`),
    );
  }

  // 5. Fuzzy match with suggestions
  const suggestions = findVehicleSuggestions(rawInput, vehicles);
  throw new ResolutionError(rawInput, 'vehicle', suggestions);
}

export function createResourceFacadeErrorResponse(
  error: unknown,
): ResourceFacadeErrorResult {
  if (error instanceof ResolutionError) {
    return {
      success: false,
      message: error.message,
      error: 'RESOLUTION_ERROR',
      entityType: error.entityType,
      input: error.input,
      suggestions: error.suggestions,
    };
  }

  if (error instanceof AmbiguityError) {
    return {
      success: false,
      message: error.message,
      error: 'AMBIGUITY_ERROR',
      entityType: error.entityType,
      input: error.input,
      suggestions: error.matches,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    message,
    error: 'OPERATION_FAILED',
  };
}
