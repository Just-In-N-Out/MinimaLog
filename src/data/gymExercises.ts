import rawCsv from "../../Updated-UniLat.csv?raw";

export interface GymExerciseSeed {
  id: number;
  name: string;
  primary_region: string;
  canUnilateral: boolean;
}

type ParsedRow = {
  id: number;
  name: string;
  primary_region: string;
  can_unilateral_raw: string;
};

const interpretUnilateralValue = (raw: string): boolean => {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;

  if (
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1"
  ) {
    return true;
  }

  if (
    normalized === "no" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "bilateral" ||
    normalized === "unilateral" ||
    normalized === "unilaterally"
  ) {
    return false;
  }

  if (import.meta.env.DEV) console.warn("Unexpected can_unilateral value encountered, defaulting to false");
  return false;
};

const parseCsv = (input: string): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  if (!input) return rows;

  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return rows;

  const dataLines = lines.slice(1); // skip header

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (char === "\"") {
        const nextChar = line[i + 1];
        if (nextChar === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        cells.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    cells.push(current);
    return cells;
  };

  dataLines.forEach((line) => {
    const cells = parseLine(line);
    if (cells.length < 4) return;

    const [, rawId, rawName, rawRegion, rawCanUnilateral] = cells;

    const id = Number.parseInt(rawId, 10);
    const name = (rawName ?? "").trim();
    const primaryRegion = (rawRegion ?? "").trim();
    const canUnilateralRaw = (rawCanUnilateral ?? "").trim();

    if (!Number.isFinite(id) || !name) return;

    rows.push({
      id,
      name,
      primary_region: primaryRegion || "Other",
      can_unilateral_raw: canUnilateralRaw,
    });
  });

  return rows;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeNameForLookup = (value: string) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s*\(unilateral\)$/i, "");

const parsedRows = parseCsv(rawCsv);

const seeds: GymExerciseSeed[] = parsedRows.map((row) => ({
  id: row.id,
  name: normalizeWhitespace(row.name),
  primary_region: normalizeWhitespace(row.primary_region || "Other"),
  canUnilateral: interpretUnilateralValue(row.can_unilateral_raw),
}));

export const gymExerciseSeeds: readonly GymExerciseSeed[] = seeds;

const uniqueRegions = Array.from(
  new Set(seeds.map((seed) => seed.primary_region)),
);

export const primaryRegions: readonly string[] = uniqueRegions.sort((a, b) =>
  a.localeCompare(b),
);

const seedIdToggleMap = new Map<string, boolean>();
const normalizedNameMap = new Map<string, GymExerciseSeed>();

seeds.forEach((seed) => {
  const key = `seed-${seed.id}`;
  seedIdToggleMap.set(key, seed.canUnilateral);

  const normalized = normalizeNameForLookup(seed.name);
  if (!normalizedNameMap.has(normalized)) {
    normalizedNameMap.set(normalized, seed);
  }

  const stripped = normalizeNameForLookup(seed.name.replace(/\([^)]*\)/g, ""));
  if (!normalizedNameMap.has(stripped)) {
    normalizedNameMap.set(stripped, seed);
  }
});

export const seedSupportsUnilateralToggle = (seedId?: string | null): boolean => {
  if (!seedId) return false;
  return seedIdToggleMap.get(seedId) ?? false;
};

export const nameSupportsUnilateralToggle = (name?: string | null): boolean => {
  if (!name) return false;
  const normalized = normalizeNameForLookup(name);
  return normalizedNameMap.get(normalized)?.canUnilateral ?? false;
};

export const findSeedByName = (name?: string | null): GymExerciseSeed | null => {
  if (!name) return null;
  const normalized = normalizeNameForLookup(name);
  return normalizedNameMap.get(normalized) ?? null;
};
