/**
 * PGCompleter - The core completion engine.
 * Ported from pgcli's pgcompleter.py
 */
import {
  CompletionItem, DbMetadata, ColumnMetadata, FunctionMetadata,
  SchemaObject, Candidate, candidate, columnMeta, TableReference,
  tableRef, refName, TableMetadata,
} from './types.js';
import { keywords, keywordsTree, functions as builtinFunctions, datatypes as builtinDatatypes, reservedWords } from './literals.js';
import { lastWord, normalizeRef, generateAlias, extractTables, findPrevKeyword } from './utils.js';

export interface CompleterOptions {
  keywordCasing?: 'upper' | 'lower' | 'auto';
  qualifyColumns?: 'always' | 'never' | 'if_more_than_one_table';
  generateAliases?: boolean;
  searchPathFilter?: boolean;
}

export class PGCompleter {
  databases: string[] = [];
  searchPath: string[] = [];
  dbmetadata: DbMetadata = {
    tables: {},
    views: {},
    functions: {},
    datatypes: {},
  };
  private keywordCasing: 'upper' | 'lower' | 'auto';
  private qualifyColumns: string;
  private generateAliasesFlag: boolean;
  private searchPathFilter: boolean;
  private namePattern = /^[_a-z][_a-z0-9$]*$/;
  private allCompletions = new Set<string>();

  constructor(options: CompleterOptions = {}) {
    this.keywordCasing = options.keywordCasing || 'upper';
    this.qualifyColumns = options.qualifyColumns || 'if_more_than_one_table';
    this.generateAliasesFlag = options.generateAliases || false;
    this.searchPathFilter = options.searchPathFilter || false;

    // Initialize with built-in completions
    for (const kw of keywords) this.allCompletions.add(kw);
    for (const fn of builtinFunctions) this.allCompletions.add(fn);
  }

  // --- Metadata population methods ---

  escapeName(name: string): string {
    if (name && (!this.namePattern.test(name) || reservedWords.has(name.toUpperCase()) || builtinFunctions.includes(name.toUpperCase()))) {
      return `"${name}"`;
    }
    return name;
  }

  unescapeName(name: string): string {
    if (name && name[0] === '"' && name[name.length - 1] === '"') {
      return name.slice(1, -1);
    }
    return name;
  }

  private escapedNames(names: string[]): string[] {
    return names.map(n => this.escapeName(n));
  }

  extendDatabases(databases: string[]): void {
    this.databases.push(...databases);
  }

  extendSchemata(schemata: string[]): void {
    const escaped = this.escapedNames(schemata);
    for (const kind of ['tables', 'views', 'functions', 'datatypes'] as const) {
      for (const schema of escaped) {
        if (!this.dbmetadata[kind][schema]) {
          (this.dbmetadata[kind] as any)[schema] = {};
        }
      }
    }
    for (const s of escaped) this.allCompletions.add(s);
  }

  setSearchPath(searchPath: string[]): void {
    this.searchPath = this.escapedNames(searchPath);
  }

  extendRelations(data: [string, string][], kind: 'tables' | 'views'): void {
    const meta = this.dbmetadata[kind];
    for (const [schema, relname] of data) {
      const [escSchema, escRel] = this.escapedNames([schema, relname]);
      if (meta[escSchema]) {
        meta[escSchema][escRel] = meta[escSchema][escRel] || {};
      }
      this.allCompletions.add(escRel);
    }
  }

  extendColumns(columnData: Array<[string, string, string, string, boolean, string | null]>, kind: 'tables' | 'views'): void {
    const meta = this.dbmetadata[kind];
    for (const [schema, relname, colname, datatype, hasDefault, default_] of columnData) {
      const [escSchema, escRel, escCol] = this.escapedNames([schema, relname, colname]);
      if (meta[escSchema]?.[escRel]) {
        meta[escSchema][escRel][escCol] = columnMeta(escCol, datatype, [], default_, hasDefault);
      }
      this.allCompletions.add(escCol);
    }
  }

  extendFunctions(funcData: FunctionMetadata[]): void {
    const meta = this.dbmetadata.functions;
    for (const f of funcData) {
      const [schema, func] = this.escapedNames([f.schemaName, f.funcName]);
      if (!meta[schema]) meta[schema] = {};
      if (meta[schema][func]) {
        meta[schema][func].push(f);
      } else {
        meta[schema][func] = [f];
      }
      this.allCompletions.add(func);
    }
  }

  extendDatatypes(typeData: [string, string][]): void {
    const meta = this.dbmetadata.datatypes;
    for (const [schema, typeName] of typeData) {
      const [escSchema, escType] = this.escapedNames([schema, typeName]);
      if (!meta[escSchema]) meta[escSchema] = {};
      meta[escSchema][escType] = null;
      this.allCompletions.add(escType);
    }
  }

  resetCompletions(): void {
    this.databases = [];
    this.searchPath = [];
    this.dbmetadata = { tables: {}, views: {}, functions: {}, datatypes: {} };
    this.allCompletions = new Set([...keywords, ...builtinFunctions]);
  }

  // --- Completion logic ---

  /**
   * Main completion method.
   * @param text Full SQL text
   * @param textBeforeCursor Text before cursor position
   * @returns Array of CompletionItem
   */
  getCompletions(text: string, textBeforeCursor: string): CompletionItem[] {
    const wordBeforeCursor = lastWord(textBeforeCursor, 'most_punctuations');
    const suggestions = this.suggestType(text, textBeforeCursor);

    if (suggestions.length === 0) {
      // Fallback: suggest all completions
      return this.findSimpleMatches(wordBeforeCursor, [...this.allCompletions], 'keyword');
    }

    const allMatches: CompletionItem[] = [];

    for (const suggestion of suggestions) {
      switch (suggestion.kind) {
        case 'keyword':
          allMatches.push(...this.getKeywordMatches(wordBeforeCursor, suggestion.lastToken));
          break;
        case 'table':
          allMatches.push(...this.getTableMatches(wordBeforeCursor, suggestion.schema));
          break;
        case 'view':
          allMatches.push(...this.getViewMatches(wordBeforeCursor, suggestion.schema));
          break;
        case 'column':
          allMatches.push(...this.getColumnMatches(wordBeforeCursor, suggestion.tableRefs, suggestion.localTables));
          break;
        case 'function':
          allMatches.push(...this.getFunctionMatches(wordBeforeCursor, suggestion.schema));
          break;
        case 'schema':
          allMatches.push(...this.getSchemaMatches(wordBeforeCursor));
          break;
        case 'database':
          allMatches.push(...this.getDatabaseMatches(wordBeforeCursor));
          break;
        case 'datatype':
          allMatches.push(...this.getDatatypeMatches(wordBeforeCursor, suggestion.schema));
          break;
        case 'fromClauseItem':
          allMatches.push(
            ...this.getTableMatches(wordBeforeCursor, suggestion.schema),
            ...this.getViewMatches(wordBeforeCursor, suggestion.schema),
            ...this.getFunctionMatches(wordBeforeCursor, suggestion.schema),
          );
          break;
        case 'alias':
          allMatches.push(...this.findSimpleMatches(wordBeforeCursor, suggestion.aliases, 'table alias'));
          break;
        // join, joinCondition, special, path, namedQuery, tableFormat are less common
        // We provide basic keyword fallback for them
        default:
          allMatches.push(...this.getKeywordMatches(wordBeforeCursor));
          break;
      }
    }

    return allMatches;
  }

  // --- Suggestion type determination ---
  // Simplified version of sqlcompletion.py's suggest_type

  private suggestType(fullText: string, textBeforeCursor: string): Array<{kind: string; [key: string]: any}> {
    const wordBefore = lastWord(textBeforeCursor, 'most_punctuations').toLowerCase();
    const stripped = textBeforeCursor.trimEnd();

    // Find the last meaningful keyword
    const prevKw = findPrevKeyword(textBeforeCursor);
    const tables = extractTables(fullText).map(t =>
      tableRef(t.schema, t.name, t.alias)
    );

    // Determine context from last keyword
    if (!prevKw && !stripped) {
      return [{ kind: 'keyword' }, { kind: 'special' }];
    }

    const lastToken = prevKw?.toUpperCase() || '';

    // Check if we're right after a dot (schema.something)
    const textUpToCursor = textBeforeCursor.trimEnd();
    const dotMatch = textUpToCursor.match(/(\w+)\.\s*$/);
    if (dotMatch) {
      const parent = dotMatch[1].toLowerCase();
      // Could be schema.table or table.column
      return [
        { kind: 'table', schema: parent, tableRefs: tables, localTables: [] },
        { kind: 'view', schema: parent, tableRefs: tables },
        { kind: 'column', tableRefs: tables.filter(t => t.alias === parent || t.name === parent), localTables: [], qualifiable: false },
        { kind: 'function', schema: parent, tableRefs: tables },
      ];
    }

    switch (lastToken) {
      case 'SELECT':
      case 'WHERE':
      case 'HAVING':
      case 'ORDER BY':
      case 'DISTINCT':
        return [
          { kind: 'column', tableRefs: tables, localTables: [], qualifiable: true },
          { kind: 'function', schema: null, tableRefs: tables },
          { kind: 'keyword', lastToken },
        ];

      case 'FROM':
      case 'JOIN':
      case 'INNER JOIN':
      case 'LEFT JOIN':
      case 'RIGHT JOIN':
      case 'FULL JOIN':
      case 'CROSS JOIN':
      case 'LEFT OUTER JOIN':
      case 'RIGHT OUTER JOIN':
      case 'FULL OUTER JOIN':
        return [
          { kind: 'fromClauseItem', schema: null, tableRefs: tables, localTables: [] },
          { kind: 'schema' },
        ];

      case 'ON':
        return [
          { kind: 'alias', aliases: tables.map(t => refName(t)) },
          { kind: 'column', tableRefs: tables, localTables: [] },
        ];

      case 'UPDATE':
      case 'INTO':
      case 'TABLE':
      case 'DESCRIBE':
      case 'TRUNCATE':
      case 'COPY':
        return [
          { kind: 'table', schema: null, tableRefs: tables, localTables: [] },
          { kind: 'view', schema: null, tableRefs: tables },
          { kind: 'schema' },
        ];

      case 'SET':
        return [
          { kind: 'column', tableRefs: tables, localTables: [] },
          { kind: 'keyword', lastToken: 'SET' },
        ];

      case 'DATABASE':
      case 'USE':
      case 'TEMPLATE':
        return [{ kind: 'database' }];

      case 'SCHEMA':
        return [{ kind: 'schema' }];

      case 'TYPE':
      case '::':
        return [
          { kind: 'datatype', schema: null },
          { kind: 'table', schema: null, tableRefs: tables, localTables: [] },
          { kind: 'schema' },
        ];

      case 'ALTER':
      case 'CREATE':
      case 'DROP':
        return [{ kind: 'keyword', lastToken }];

      case 'FUNCTION':
        return [
          { kind: 'function', schema: null, tableRefs: tables, usage: 'signature' },
          { kind: 'schema' },
        ];

      default:
        // If after comma or AND/OR, try to recurse
        if (lastToken.endsWith(',') || ['AND', 'OR', '='].includes(lastToken)) {
          // Re-suggest based on broader context
          const broaderKw = this.findBroaderKeyword(textBeforeCursor);
          if (broaderKw) {
            return this.suggestType(fullText, broaderKw.text);
          }
        }
        return [{ kind: 'keyword', lastToken }];
    }
  }

  private findBroaderKeyword(text: string): { keyword: string; text: string } | null {
    // Strip the last token and find the previous keyword
    const stripped = text.replace(/[,=]?\s*\w*$/, '').trimEnd();
    const kw = findPrevKeyword(stripped);
    if (kw) return { keyword: kw, text: stripped };
    return null;
  }

  // --- Match methods ---

  private caseKeyword(kw: string, wordBefore: string): string {
    let casing = this.keywordCasing;
    if (casing === 'auto') {
      casing = (wordBefore && wordBefore[wordBefore.length - 1] === wordBefore[wordBefore.length - 1].toLowerCase())
        ? 'lower' : 'upper';
    }
    return casing === 'upper' ? kw.toUpperCase() : kw.toLowerCase();
  }

  getKeywordMatches(wordBeforeCursor: string, lastToken?: string): CompletionItem[] {
    let kws = Object.keys(keywordsTree);
    // Narrow to next-keywords if available
    if (lastToken) {
      const next = keywordsTree[lastToken.toUpperCase()];
      if (next && next.length > 0) kws = next;
    }
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    return kws
      .filter(k => k.toLowerCase().startsWith(text))
      .map(k => ({
        text: this.caseKeyword(k, wordBeforeCursor),
        type: 'keyword',
        priority: 0,
      }));
  }

  getTableMatches(wordBeforeCursor: string, schema: string | null): CompletionItem[] {
    const objects = this.populateSchemaObjects(schema, 'tables');
    return this.matchSchemaObjects(wordBeforeCursor, objects, 'table');
  }

  getViewMatches(wordBeforeCursor: string, schema: string | null): CompletionItem[] {
    const objects = this.populateSchemaObjects(schema, 'views');
    return this.matchSchemaObjects(wordBeforeCursor, objects, 'view');
  }

  getColumnMatches(wordBeforeCursor: string, tableRefs: TableReference[], localTables: TableMetadata[] = []): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    const results: CompletionItem[] = [];

    for (const tbl of tableRefs) {
      const schemas = tbl.schema ? [this.escapeName(tbl.schema)] : this.searchPath.length ? this.searchPath : Object.keys(this.dbmetadata.tables);
      for (const schema of schemas) {
        const relname = this.escapeName(tbl.name);
        for (const kind of ['tables', 'views'] as const) {
          const cols = this.dbmetadata[kind][schema]?.[relname];
          if (cols) {
            for (const colName of Object.keys(cols)) {
              if (colName.toLowerCase().startsWith(text) || this.fuzzyMatch(text, colName)) {
                results.push({
                  text: colName,
                  type: 'column',
                  schema: schema,
                  priority: 100,
                });
              }
            }
          }
        }
      }
    }

    // Add columns from local tables (CTEs)
    for (const lt of localTables) {
      for (const col of lt.columns) {
        if (col.name.toLowerCase().startsWith(text) || this.fuzzyMatch(text, col.name)) {
          results.push({ text: col.name, type: 'column', priority: 90 });
        }
      }
    }

    return results;
  }

  getFunctionMatches(wordBeforeCursor: string, schema: string | null): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    const results: CompletionItem[] = [];

    // Schema-qualified functions from metadata
    const schemas = this.getSchemas('functions', schema);
    for (const sch of schemas) {
      const funcs = this.dbmetadata.functions[sch] || {};
      for (const funcName of Object.keys(funcs)) {
        if (funcName.toLowerCase().startsWith(text) || this.fuzzyMatch(text, funcName)) {
          const prefix = (schema || (!this.searchPath.includes(sch) && sch !== 'public')) ? `${sch}.` : '';
          results.push({
            text: prefix + funcName,
            type: 'function',
            schema: sch,
            priority: 80,
          });
        }
      }
    }

    // Also suggest built-in functions
    if (!schema) {
      for (const fn of builtinFunctions) {
        if (fn.toLowerCase().startsWith(text)) {
          results.push({ text: fn, type: 'function', priority: 50 });
        }
      }
    }

    return results;
  }

  getSchemaMatches(wordBeforeCursor: string): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    const schemaNames = Object.keys(this.dbmetadata.tables);
    return schemaNames
      .filter(s => !s.startsWith('pg_') || text.startsWith('pg_'))
      .filter(s => s.toLowerCase().startsWith(text) || this.fuzzyMatch(text, s))
      .map(s => ({ text: s, type: 'schema', priority: 60 }));
  }

  getDatabaseMatches(wordBeforeCursor: string): CompletionItem[] {
    return this.findSimpleMatches(wordBeforeCursor, this.databases, 'database');
  }

  getDatatypeMatches(wordBeforeCursor: string, schema: string | null): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    const results: CompletionItem[] = [];

    // Custom types from metadata
    const schemas = this.getSchemas('datatypes', schema);
    for (const sch of schemas) {
      const types = this.dbmetadata.datatypes[sch] || {};
      for (const typeName of Object.keys(types)) {
        if (typeName.toLowerCase().startsWith(text) || this.fuzzyMatch(text, typeName)) {
          results.push({ text: typeName, type: 'datatype', schema: sch, priority: 70 });
        }
      }
    }

    // Built-in datatypes
    if (!schema) {
      for (const dt of builtinDatatypes) {
        if (dt.toLowerCase().startsWith(text)) {
          results.push({ text: dt, type: 'datatype', priority: 40 });
        }
      }
    }

    return results;
  }

  // --- Helpers ---

  private getSchemas(objType: keyof DbMetadata, schema: string | null): string[] {
    const metadata = this.dbmetadata[objType];
    if (schema) {
      const escaped = this.escapeName(schema);
      return escaped in metadata ? [escaped] : [];
    }
    return this.searchPathFilter && this.searchPath.length
      ? this.searchPath
      : Object.keys(metadata);
  }

  private populateSchemaObjects(schema: string | null, objType: 'tables' | 'views'): SchemaObject[] {
    const result: SchemaObject[] = [];
    for (const sch of this.getSchemas(objType, schema)) {
      for (const obj of Object.keys(this.dbmetadata[objType][sch] || {})) {
        const maybeSchema = (schema || this.searchPath.includes(sch)) ? null : sch;
        result.push({ name: obj, schema: maybeSchema });
      }
    }
    return result;
  }

  private matchSchemaObjects(wordBeforeCursor: string, objects: SchemaObject[], meta: string): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    return objects
      .filter(o => {
        const fullName = o.schema ? `${o.schema}.${o.name}` : o.name;
        return fullName.toLowerCase().startsWith(text) || o.name.toLowerCase().startsWith(text) || this.fuzzyMatch(text, o.name);
      })
      .filter(o => !o.name.startsWith('pg_') || text.startsWith('pg_'))
      .map(o => ({
        text: o.schema ? `${o.schema}.${o.name}` : o.name,
        type: meta,
        schema: o.schema || undefined,
        priority: meta === 'table' ? 90 : 80,
      }));
  }

  private findSimpleMatches(wordBeforeCursor: string, items: string[], meta: string): CompletionItem[] {
    const text = lastWord(wordBeforeCursor, 'most_punctuations').toLowerCase();
    return items
      .filter(item => item.toLowerCase().startsWith(text) || this.fuzzyMatch(text, item))
      .map(item => ({ text: item, type: meta, priority: 50 }));
  }

  private fuzzyMatch(text: string, item: string): boolean {
    if (!text) return true;
    const lower = item.toLowerCase();
    let j = 0;
    for (let i = 0; i < lower.length && j < text.length; i++) {
      if (lower[i] === text[j]) j++;
    }
    return j === text.length;
  }
}
