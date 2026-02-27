#!/usr/bin/env node
/**
 * CLI for pgcomplete - interactive SQL completion with PostgreSQL.
 *
 * Usage:
 *   pgcomplete --dsn postgres://user:pass@host/db
 *   pgcomplete --host localhost --port 5432 --database mydb --user postgres
 *   pgcomplete --dsn ... --json          # JSON output mode
 *   pgcomplete --dsn ... --query "SELECT " --cursor 7   # one-shot completion
 */
import { createInterface } from 'readline';
import { PGCompleter } from './completer.js';
import { loadMetadata, DbConnectionOptions } from './db.js';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const jsonMode = args.json === 'true';

  // Build connection options
  const connOpts: DbConnectionOptions = {};
  if (args.dsn) {
    connOpts.connectionString = args.dsn;
  } else {
    if (args.host) connOpts.host = args.host;
    if (args.port) connOpts.port = parseInt(args.port, 10);
    if (args.database) connOpts.database = args.database;
    if (args.user) connOpts.user = args.user;
    if (args.password) connOpts.password = args.password;
  }

  // Check if we have connection info
  const hasConn = connOpts.connectionString || connOpts.host || connOpts.database;

  const completer = new PGCompleter();

  if (hasConn) {
    try {
      if (!jsonMode) process.stderr.write('Loading database metadata...\n');
      const meta = await loadMetadata(connOpts);
      completer.extendDatabases(meta.databases);
      completer.extendSchemata(meta.schemata);
      completer.setSearchPath(meta.searchPath);
      completer.extendRelations(meta.tables, 'tables');
      completer.extendRelations(meta.views, 'views');
      completer.extendColumns(meta.columns, 'tables');
      completer.extendColumns(meta.viewColumns, 'views');
      completer.extendFunctions(meta.functions);
      completer.extendDatatypes(meta.datatypes);
      if (!jsonMode) process.stderr.write(`Loaded: ${meta.tables.length} tables, ${meta.views.length} views, ${meta.functions.length} functions\n`);
    } catch (err: any) {
      process.stderr.write(`Failed to connect: ${err.message}\n`);
      if (!args.query) process.exit(1);
    }
  }

  // One-shot mode: --query "SELECT " --cursor 7
  if (args.query !== undefined) {
    const cursor = args.cursor ? parseInt(args.cursor, 10) : args.query.length;
    const textBeforeCursor = args.query.slice(0, cursor);
    const completions = completer.getCompletions(args.query, textBeforeCursor);

    if (jsonMode) {
      console.log(JSON.stringify(completions, null, 2));
    } else {
      for (const c of completions) {
        console.log(`${c.text}\t${c.type}${c.schema ? '\t' + c.schema : ''}`);
      }
    }
    return;
  }

  // Interactive mode
  if (!jsonMode) {
    process.stderr.write('pgcomplete interactive mode. Type SQL and press Enter for completions.\n');
    process.stderr.write('Type .exit to quit.\n\n');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: jsonMode ? '' : 'sql> ',
  });

  if (!jsonMode) rl.prompt();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed === '.exit' || trimmed === '\\q') {
      rl.close();
      return;
    }

    const completions = completer.getCompletions(trimmed, trimmed);

    if (jsonMode) {
      console.log(JSON.stringify(completions));
    } else {
      if (completions.length === 0) {
        console.log('(no completions)');
      } else {
        for (const c of completions.slice(0, 30)) {
          console.log(`  ${c.text.padEnd(40)} ${c.type}`);
        }
        if (completions.length > 30) {
          console.log(`  ... and ${completions.length - 30} more`);
        }
      }
      rl.prompt();
    }
  });

  rl.on('close', () => process.exit(0));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
