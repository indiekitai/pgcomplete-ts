/**
 * @indiekitai/pgcomplete - PostgreSQL auto-completion engine
 *
 * Ported from pgcli's pgcompleter.py
 */
export { PGCompleter, CompleterOptions } from './completer.js';
export { loadMetadata, DbConnectionOptions } from './db.js';
export type {
  CompletionItem,
  ColumnMetadata,
  ForeignKey,
  TableReference,
  TableMetadata,
  SchemaObject,
  FunctionMetadata,
  DbMetadata,
} from './types.js';
export { keywords, keywordsTree, functions, datatypes, reservedWords } from './literals.js';
export { lastWord, generateAlias, extractTables } from './utils.js';
