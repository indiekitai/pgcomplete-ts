#!/usr/bin/env node
/**
 * MCP Server for pgcomplete - exposes SQL completion as MCP tools.
 *
 * Tools:
 *   - complete: Get SQL completions for a query at cursor position
 *   - list_tables: List all known tables
 *   - list_columns: List columns for a table
 *   - list_functions: List known functions
 *   - list_schemas: List schemas
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PGCompleter } from './completer.js';
import { loadMetadata } from './db.js';

const completer = new PGCompleter();
let initialized = false;

async function initFromEnv(): Promise<string> {
  const dsn = process.env.PGCOMPLETE_DSN || process.env.DATABASE_URL;
  if (!dsn) return 'No database connection (set PGCOMPLETE_DSN or DATABASE_URL). Keywords-only mode.';

  try {
    const meta = await loadMetadata({ connectionString: dsn });
    completer.extendDatabases(meta.databases);
    completer.extendSchemata(meta.schemata);
    completer.setSearchPath(meta.searchPath);
    completer.extendRelations(meta.tables, 'tables');
    completer.extendRelations(meta.views, 'views');
    completer.extendColumns(meta.columns, 'tables');
    completer.extendColumns(meta.viewColumns, 'views');
    completer.extendFunctions(meta.functions);
    completer.extendDatatypes(meta.datatypes);
    initialized = true;
    return `Connected. ${meta.tables.length} tables, ${meta.views.length} views, ${meta.functions.length} functions.`;
  } catch (err: any) {
    return `DB connection failed: ${err.message}. Keywords-only mode.`;
  }
}

const server = new McpServer({
  name: 'pgcomplete',
  version: '0.1.0',
});

server.tool(
  'complete',
  'Get SQL auto-completions at cursor position',
  {
    query: z.string().describe('The full SQL query text'),
    cursor: z.number().optional().describe('Cursor position (defaults to end of query)'),
  },
  async ({ query, cursor }) => {
    if (!initialized) await initFromEnv();
    const pos = cursor ?? query.length;
    const textBefore = query.slice(0, pos);
    const completions = completer.getCompletions(query, textBefore);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(completions, null, 2) }],
    };
  }
);

server.tool(
  'list_tables',
  'List all known tables in the database',
  {
    schema: z.string().optional().describe('Filter by schema name'),
  },
  async ({ schema }) => {
    if (!initialized) await initFromEnv();
    const meta = completer.dbmetadata.tables;
    const results: Array<{ schema: string; table: string }> = [];
    for (const [sch, tables] of Object.entries(meta)) {
      if (schema && sch !== schema) continue;
      for (const tbl of Object.keys(tables)) {
        results.push({ schema: sch, table: tbl });
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  'list_columns',
  'List columns for a specific table',
  {
    table: z.string().describe('Table name'),
    schema: z.string().optional().describe('Schema name (defaults to search path)'),
  },
  async ({ table, schema }) => {
    if (!initialized) await initFromEnv();
    const results: Array<{ column: string; type: string | null }> = [];
    const schemas = schema ? [schema] : Object.keys(completer.dbmetadata.tables);
    for (const sch of schemas) {
      const cols = completer.dbmetadata.tables[sch]?.[table];
      if (cols) {
        for (const [name, meta] of Object.entries(cols)) {
          results.push({ column: name, type: meta.datatype });
        }
        break;
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  'list_functions',
  'List known database functions',
  {
    schema: z.string().optional().describe('Filter by schema name'),
  },
  async ({ schema }) => {
    if (!initialized) await initFromEnv();
    const meta = completer.dbmetadata.functions;
    const results: Array<{ schema: string; function: string; returnType: string }> = [];
    for (const [sch, funcs] of Object.entries(meta)) {
      if (schema && sch !== schema) continue;
      for (const [name, metas] of Object.entries(funcs)) {
        for (const m of metas) {
          results.push({ schema: sch, function: name, returnType: m.returnType });
        }
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  'list_schemas',
  'List all schemas in the database',
  {},
  async () => {
    if (!initialized) await initFromEnv();
    const schemas = Object.keys(completer.dbmetadata.tables);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(schemas, null, 2) }],
    };
  }
);

async function main() {
  const status = await initFromEnv();
  process.stderr.write(`pgcomplete MCP server: ${status}\n`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
