/**
 * Core types for pgcomplete, ported from pgcli's Python codebase.
 */

// --- Metadata types (from parseutils/meta.py) ---

export interface ColumnMetadata {
  name: string;
  datatype: string | null;
  foreignkeys: ForeignKey[];
  default_: string | null;
  hasDefault: boolean;
}

export function columnMeta(
  name: string,
  datatype: string | null = null,
  foreignkeys: ForeignKey[] = [],
  default_: string | null = null,
  hasDefault = false
): ColumnMetadata {
  return { name, datatype, foreignkeys, default_, hasDefault };
}

export interface ForeignKey {
  parentschema: string;
  parenttable: string;
  parentcolumn: string;
  childschema: string;
  childtable: string;
  childcolumn: string;
}

export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
}

// --- Table reference (from parseutils/tables.py) ---

export interface TableReference {
  schema: string | null;
  name: string;
  alias: string | null;
  isFunction: boolean;
}

export function tableRef(
  schema: string | null,
  name: string,
  alias: string | null = null,
  isFunction = false
): TableReference {
  return { schema, name, alias, isFunction };
}

export function tableRefKey(t: TableReference): string {
  return `${t.schema || ''}.${t.name}.${t.alias || ''}`;
}

/** The effective reference name used in queries */
export function refName(t: TableReference): string {
  if (t.alias) return t.alias;
  if (t.name.toLowerCase() === t.name || t.name.startsWith('"')) return t.name;
  return `"${t.name}"`;
}

// --- Suggestion types (from sqlcompletion.py) ---

export type SuggestionType =
  | { kind: 'keyword'; lastToken?: string }
  | { kind: 'table'; schema: string | null; tableRefs: TableReference[]; localTables: TableMetadata[] }
  | { kind: 'view'; schema: string | null; tableRefs: TableReference[] }
  | { kind: 'column'; tableRefs: TableReference[]; requireLastTable?: boolean; localTables: TableMetadata[]; qualifiable?: boolean; context?: string }
  | { kind: 'function'; schema: string | null; tableRefs: TableReference[]; usage?: string }
  | { kind: 'schema'; quoted?: boolean }
  | { kind: 'database' }
  | { kind: 'datatype'; schema: string | null }
  | { kind: 'alias'; aliases: string[] }
  | { kind: 'fromClauseItem'; schema: string | null; tableRefs: TableReference[]; localTables: TableMetadata[] }
  | { kind: 'join'; tableRefs: TableReference[]; schema: string | null }
  | { kind: 'joinCondition'; tableRefs: TableReference[]; parent: TableReference | null }
  | { kind: 'special' }
  | { kind: 'path' }
  | { kind: 'namedQuery' }
  | { kind: 'tableFormat' };

// --- Completion result ---

export interface CompletionItem {
  text: string;
  displayText?: string;
  type: string; // 'keyword' | 'table' | 'column' | 'function' | 'schema' | 'view' | 'database' | 'datatype' | 'join' etc.
  schema?: string;
  /** Sort priority - higher is more relevant */
  priority?: number;
}

// --- Schema object (from pgcompleter.py) ---

export interface SchemaObject {
  name: string;
  schema: string | null;
  meta?: any;
}

// --- Candidate for matching ---

export interface Candidate {
  completion: string;
  prio: number;
  meta: string | null;
  synonyms: string[];
  prio2: number;
  display: string;
}

export function candidate(
  completion: string,
  prio = 0,
  meta: string | null = null,
  synonyms?: string[],
  prio2 = 0,
  display?: string
): Candidate {
  return {
    completion,
    prio,
    meta,
    synonyms: synonyms || [completion],
    prio2,
    display: display || completion,
  };
}

// --- DB metadata shape ---

export interface DbMetadata {
  tables: Record<string, Record<string, Record<string, ColumnMetadata>>>;
  views: Record<string, Record<string, Record<string, ColumnMetadata>>>;
  functions: Record<string, Record<string, FunctionMetadata[]>>;
  datatypes: Record<string, Record<string, null>>;
}

// --- Function metadata (from parseutils/meta.py) ---

export interface FunctionArg {
  name: string;
  type: string | null;
  mode: string; // 'i' | 'o' | 'b' | 'v' | 't'
}

export class FunctionMetadata {
  schemaName: string;
  funcName: string;
  argNames: string[] | null;
  argTypes: string[] | null;
  argModes: string[] | null;
  returnType: string;
  isAggregate: boolean;
  isWindow: boolean;
  isSetReturning: boolean;
  isExtension: boolean;
  argDefaults: string[];
  isPublic: boolean;

  constructor(
    schemaName: string,
    funcName: string,
    argNames: string[] | null,
    argTypes: string[] | null,
    argModes: string[] | null,
    returnType: string,
    isAggregate: boolean,
    isWindow: boolean,
    isSetReturning: boolean,
    isExtension: boolean,
    argDefaults: string[]
  ) {
    this.schemaName = schemaName;
    this.funcName = funcName;
    this.argNames = argNames;
    this.argTypes = argTypes;
    this.argModes = argModes;
    this.returnType = returnType.trim();
    this.isAggregate = isAggregate;
    this.isWindow = isWindow;
    this.isSetReturning = isSetReturning;
    this.isExtension = isExtension;
    this.argDefaults = argDefaults;
    this.isPublic = schemaName === 'public';
  }

  args(): ColumnMetadata[] {
    if (!this.argNames) return [];
    const modes = this.argModes || this.argNames.map(() => 'i');
    const types = this.argTypes || this.argNames.map(() => null);
    const pairs: [string, string | null][] = [];
    for (let i = 0; i < this.argNames.length; i++) {
      if (['i', 'b', 'v'].includes(modes[i])) {
        pairs.push([this.argNames[i], types[i]]);
      }
    }
    return pairs.map(([name, typ], num) => {
      const numArgs = pairs.length;
      const numDefaults = this.argDefaults.length;
      const hasDefault = num + numDefaults >= numArgs;
      const default_ = hasDefault ? (this.argDefaults[num - numArgs + numDefaults] ?? null) : null;
      return columnMeta(name, typ, [], default_, hasDefault);
    });
  }

  fields(): ColumnMetadata[] {
    if (this.returnType.toLowerCase() === 'void') return [];
    if (!this.argModes) {
      return [columnMeta(this.funcName, this.returnType, [])];
    }
    const result: ColumnMetadata[] = [];
    const names = this.argNames || [];
    const types = this.argTypes || [];
    for (let i = 0; i < (this.argModes?.length || 0); i++) {
      if (['o', 'b', 't'].includes(this.argModes![i])) {
        result.push(columnMeta(names[i] || '', types[i] || null, []));
      }
    }
    return result;
  }
}
