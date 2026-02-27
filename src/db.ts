/**
 * Database metadata loader - fetches schema info from PostgreSQL.
 */
import pg from 'pg';
import { FunctionMetadata } from './types.js';

const { Client } = pg;

export interface DbConnectionOptions {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  connectionString?: string;
}

export async function loadMetadata(connOpts: DbConnectionOptions) {
  const client = new Client(connOpts);
  await client.connect();

  try {
    const [databases, schemata, searchPath, tables, views, columns, viewColumns, funcs, types] = await Promise.all([
      client.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname`),
      client.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp%' ORDER BY nspname`),
      client.query<{ schema: string }>(`SELECT unnest(current_schemas(false)) AS schema`),
      client.query<{ schemaname: string; tablename: string }>(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename`),
      client.query<{ schemaname: string; viewname: string }>(`SELECT schemaname, viewname FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, viewname`),
      client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string; column_default: string | null }>(
        `SELECT table_schema, table_name, column_name, data_type, column_default
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name, ordinal_position`
      ),
      client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string; column_default: string | null }>(
        `SELECT table_schema, table_name, column_name, data_type, column_default
         FROM information_schema.columns
         WHERE (table_schema, table_name) IN (
           SELECT schemaname, viewname FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         )
         ORDER BY table_schema, table_name, ordinal_position`
      ),
      client.query<{
        schema_name: string; func_name: string;
        arg_names: string[] | null; arg_types: string[] | null; arg_modes: string[] | null;
        return_type: string; is_aggregate: boolean; is_window: boolean;
        is_set_returning: boolean; is_extension: boolean; arg_defaults: string | null;
      }>(
        `SELECT
           n.nspname AS schema_name,
           p.proname AS func_name,
           COALESCE(p.proargnames, '{}') AS arg_names,
           COALESCE(
             string_to_array(pg_get_function_arguments(p.oid), ', '),
             '{}'
           ) AS arg_types,
           p.proargmodes::text[] AS arg_modes,
           pg_catalog.pg_get_function_result(p.oid) AS return_type,
           p.prokind = 'a' AS is_aggregate,
           p.prokind = 'w' AS is_window,
           p.proretset AS is_set_returning,
           EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') AS is_extension,
           pg_get_expr(p.proargdefaults, 0) AS arg_defaults
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY n.nspname, p.proname`
      ),
      client.query<{ schema_name: string; type_name: string }>(
        `SELECT n.nspname AS schema_name, t.typname AS type_name
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND t.typtype IN ('c', 'e', 'd')
         ORDER BY n.nspname, t.typname`
      ),
    ]);

    return {
      databases: databases.rows.map(r => r.datname),
      schemata: schemata.rows.map(r => r.nspname),
      searchPath: searchPath.rows.map(r => r.schema),
      tables: tables.rows.map(r => [r.schemaname, r.tablename] as [string, string]),
      views: views.rows.map(r => [r.schemaname, r.viewname] as [string, string]),
      columns: columns.rows.map(r => [
        r.table_schema, r.table_name, r.column_name, r.data_type,
        r.column_default !== null, r.column_default,
      ] as [string, string, string, string, boolean, string | null]),
      viewColumns: viewColumns.rows.map(r => [
        r.table_schema, r.table_name, r.column_name, r.data_type,
        r.column_default !== null, r.column_default,
      ] as [string, string, string, string, boolean, string | null]),
      functions: funcs.rows.map(r => new FunctionMetadata(
        r.schema_name, r.func_name,
        r.arg_names?.length ? r.arg_names : null,
        r.arg_types?.length ? r.arg_types : null,
        r.arg_modes?.length ? r.arg_modes : null,
        r.return_type || 'void',
        r.is_aggregate, r.is_window, r.is_set_returning, r.is_extension,
        r.arg_defaults ? parseDefaults(r.arg_defaults) : [],
      )),
      datatypes: types.rows.map(r => [r.schema_name, r.type_name] as [string, string]),
    };
  } finally {
    await client.end();
  }
}

function parseDefaults(s: string): string[] {
  if (!s) return [];
  const results: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  for (const ch of s) {
    if (current === '' && ch === ' ') continue;
    if ((ch === '"' || ch === "'")) {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
    } else if (ch === ',' && !inQuote) {
      results.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  results.push(current);
  return results;
}
