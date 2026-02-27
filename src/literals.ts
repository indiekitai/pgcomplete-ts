/**
 * PostgreSQL literals: keywords, functions, datatypes, reserved words.
 * Loaded from pgliterals.json (originally from pgcli).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PgLiterals {
  keywords: Record<string, string[]>;
  functions: string[];
  datatypes: string[];
  reserved: string[];
}

// Try dist/../pgliterals.json first (installed package), then src/../ (dev)
let literalsPath = join(__dirname, '..', 'pgliterals.json');
let data: PgLiterals;
try {
  data = JSON.parse(readFileSync(literalsPath, 'utf-8'));
} catch {
  literalsPath = join(__dirname, '..', '..', 'pgliterals.json');
  data = JSON.parse(readFileSync(literalsPath, 'utf-8'));
}

/** Keyword tree: keyword -> array of common following keywords */
export const keywordsTree: Record<string, string[]> = data.keywords;

/** All keywords (flattened from tree keys + values) */
export const keywords: string[] = Array.from(
  new Set([...Object.keys(data.keywords), ...Object.values(data.keywords).flat()])
);

/** Built-in function names */
export const functions: string[] = data.functions;

/** Built-in datatype names */
export const datatypes: string[] = data.datatypes;

/** Reserved words */
export const reservedWords: Set<string> = new Set(data.reserved);
