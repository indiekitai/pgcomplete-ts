# @indiekitai/pgcomplete

PostgreSQL auto-completion engine for TypeScript/Node.js, ported from [pgcli](https://github.com/dbcli/pgcli)'s `pgcompleter.py`.

## Features

- **SQL keyword completion** — context-aware keyword suggestions (e.g., suggests `TABLE` after `CREATE`)
- **Table/view completion** — suggests tables and views from your database, schema-qualified
- **Column completion** — suggests columns based on tables in your query's FROM clause
- **Function completion** — built-in PostgreSQL functions + user-defined functions
- **Schema-aware** — respects `search_path`, supports `schema.table` notation
- **Datatype completion** — built-in and custom types
- **Fuzzy matching** — type partial text and get relevant suggestions
- **MCP Server** — expose completions as MCP tools for AI agents
- **CLI** — interactive and one-shot modes with JSON output

## Installation

```bash
npm install @indiekitai/pgcomplete
```

## CLI Usage

### Interactive mode

```bash
npx @indiekitai/pgcomplete --dsn postgres://user:pass@localhost/mydb
```

### One-shot mode

```bash
# Get completions for a query
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT * FROM " 

# JSON output
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT * FROM " --json

# Specify cursor position
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT  FROM users" --cursor 7 --json
```

### Without database (keywords only)

```bash
npx @indiekitai/pgcomplete --query "SEL" --json
```

### Connection options

```bash
npx @indiekitai/pgcomplete --host localhost --port 5432 --database mydb --user postgres --password secret
```

## Library Usage

```typescript
import { PGCompleter, loadMetadata } from '@indiekitai/pgcomplete';

// Create completer
const completer = new PGCompleter({ keywordCasing: 'upper' });

// Load metadata from database
const meta = await loadMetadata({ connectionString: 'postgres://...' });
completer.extendDatabases(meta.databases);
completer.extendSchemata(meta.schemata);
completer.setSearchPath(meta.searchPath);
completer.extendRelations(meta.tables, 'tables');
completer.extendRelations(meta.views, 'views');
completer.extendColumns(meta.columns, 'tables');
completer.extendColumns(meta.viewColumns, 'views');
completer.extendFunctions(meta.functions);
completer.extendDatatypes(meta.datatypes);

// Get completions
const query = 'SELECT * FROM ';
const completions = completer.getCompletions(query, query);
// Returns: [{ text: 'users', type: 'table' }, { text: 'orders', type: 'table' }, ...]

// Or without database connection (keywords + built-in functions only)
const kw = new PGCompleter();
const results = kw.getCompletions('SEL', 'SEL');
// Returns: [{ text: 'SELECT', type: 'keyword' }]
```

## MCP Server

The MCP server exposes SQL completion as tools for AI agents.

### Setup

Set the database connection via environment variable:

```bash
export PGCOMPLETE_DSN=postgres://user:pass@localhost/mydb
# or
export DATABASE_URL=postgres://user:pass@localhost/mydb
```

### Run

```bash
npx @indiekitai/pgcomplete-mcp
# or
node dist/mcp.js
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `complete` | Get SQL auto-completions at cursor position |
| `list_tables` | List all known tables (optionally filtered by schema) |
| `list_columns` | List columns for a specific table |
| `list_functions` | List known database functions |
| `list_schemas` | List all schemas |

### MCP Configuration

```json
{
  "mcpServers": {
    "pgcomplete": {
      "command": "npx",
      "args": ["@indiekitai/pgcomplete-mcp"],
      "env": {
        "PGCOMPLETE_DSN": "postgres://user:pass@localhost/mydb"
      }
    }
  }
}
```

## API Reference

### `PGCompleter`

The core completion engine.

```typescript
new PGCompleter(options?: {
  keywordCasing?: 'upper' | 'lower' | 'auto';  // default: 'upper'
  qualifyColumns?: 'always' | 'never' | 'if_more_than_one_table';
  generateAliases?: boolean;
  searchPathFilter?: boolean;
})
```

#### Methods

- **`getCompletions(text, textBeforeCursor)`** — Main method. Returns `CompletionItem[]`
- **`extendDatabases(databases)`** — Add database names
- **`extendSchemata(schemata)`** — Add schema names
- **`setSearchPath(path)`** — Set the search path
- **`extendRelations(data, kind)`** — Add tables or views
- **`extendColumns(data, kind)`** — Add column metadata
- **`extendFunctions(data)`** — Add function metadata
- **`extendDatatypes(data)`** — Add custom datatypes
- **`resetCompletions()`** — Clear all metadata

### `CompletionItem`

```typescript
interface CompletionItem {
  text: string;        // The completion text
  displayText?: string; // Optional display text
  type: string;        // 'keyword' | 'table' | 'column' | 'function' | 'schema' | 'view' | 'database' | 'datatype'
  schema?: string;     // Schema name if applicable
  priority?: number;   // Sort priority (higher = more relevant)
}
```

### `loadMetadata(connOpts)`

Fetches all metadata from a PostgreSQL database.

```typescript
const meta = await loadMetadata({
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
});
```

## Credits

Ported from [pgcli](https://github.com/dbcli/pgcli) by [dbcli](https://github.com/dbcli). Original Python code by Amjith Ramanujam and contributors.

## License

MIT
