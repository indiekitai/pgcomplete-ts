/**
 * Utility functions ported from parseutils/utils.py
 */

const cleanupRegex: Record<string, RegExp> = {
  alphanum_underscore: /(\w+)$/,
  many_punctuations: /([^():,\s]+)$/,
  most_punctuations: /([^.():,\s]+)$/,
  all_punctuations: /([^\s]+)$/,
};

/**
 * Find the last word in a sentence.
 */
export function lastWord(text: string, include = 'alphanum_underscore'): string {
  if (!text) return '';
  if (text[text.length - 1].match(/\s/)) return '';
  const regex = cleanupRegex[include];
  const m = text.match(regex);
  return m ? m[0] : '';
}

/**
 * Normalize a reference for comparison (lowercase unquoted, keep quoted as-is).
 */
export function normalizeRef(ref: string): string {
  if (ref[0] === '"') return ref;
  return '"' + ref.toLowerCase() + '"';
}

/**
 * Generate a table alias from a table name.
 */
export function generateAlias(tbl: string, aliasMap?: Record<string, string> | null): string {
  if (aliasMap && tbl in aliasMap) return aliasMap[tbl];
  // All uppercase letters
  const upper = tbl.split('').filter(c => c >= 'A' && c <= 'Z');
  if (upper.length > 0) return upper.join('');
  // First letter + letters after underscores
  const parts: string[] = [];
  for (let i = 0; i < tbl.length; i++) {
    if (i === 0 && tbl[i] !== '_') parts.push(tbl[i]);
    else if (i > 0 && tbl[i - 1] === '_' && tbl[i] !== '_') parts.push(tbl[i]);
  }
  return parts.join('');
}

/**
 * Simple SQL keyword-level tokenizer.
 * We don't port sqlparse; instead we do lightweight parsing.
 */
export function splitStatements(sql: string): string[] {
  // Naive split on semicolons outside quotes
  const stmts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inDollar: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inDollar) {
      current += ch;
      if (current.endsWith(inDollar)) inDollar = null;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === '$' && !inSingle && !inDouble) {
      // Check for dollar quoting
      const rest = sql.slice(i);
      const m = rest.match(/^(\$[^$]*\$)/);
      if (m) {
        inDollar = m[1];
        current += ch;
      } else {
        current += ch;
      }
    } else if (ch === ';' && !inSingle && !inDouble) {
      stmts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}

/**
 * Extract the statement being edited (the one containing the cursor position).
 */
export function currentStatement(fullText: string, textBeforeCursor: string): string {
  const pos = textBeforeCursor.length;
  const stmts: { start: number; end: number; text: string }[] = [];
  let offset = 0;
  for (const stmt of splitStatements(fullText)) {
    const idx = fullText.indexOf(stmt, offset);
    stmts.push({ start: idx, end: idx + stmt.length, text: stmt });
    offset = idx + stmt.length;
  }
  for (const s of stmts) {
    if (pos <= s.end + 1) return s.text;
  }
  return stmts.length > 0 ? stmts[stmts.length - 1].text : fullText;
}

/**
 * Very simple extractor: find the last keyword-like token before cursor.
 */
export function findPrevKeyword(textBeforeCursor: string): string | null {
  // Strip trailing partial word
  const stripped = textBeforeCursor.replace(/\w+$/, '').trimEnd();
  if (!stripped) return null;
  // Tokenize into words and find last keyword-like token
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // Walk backwards to find a keyword-like token
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[();,]/g, '').toUpperCase();
    if (t && /^[A-Z_]+(\s+[A-Z_]+)?$/.test(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Lightweight extraction of table references from SQL.
 * Handles: FROM/JOIN/INTO/UPDATE table [alias], including schema.table alias
 */
export interface SimpleTableRef {
  schema: string | null;
  name: string;
  alias: string | null;
}

export function extractTables(sql: string): SimpleTableRef[] {
  const tables: SimpleTableRef[] = [];
  // Match FROM/JOIN/INTO/UPDATE/TABLE followed by identifier(s)
  // Match keyword followed by everything until a SQL clause keyword or end
  const tablePattern = /(?:FROM|JOIN|INTO|UPDATE|TABLE|COPY)\s+/gi;
  const clauseKeywords = new Set(['ON', 'WHERE', 'SET', 'VALUES', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'FULL', 'USING', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'RETURNING']);
  let m: RegExpExecArray | null;
  while ((m = tablePattern.exec(sql)) !== null) {
    const afterKw = sql.slice(m.index + m[0].length);
    // Tokenize and extract table refs until we hit a keyword
    const tokens = afterKw.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      let tok = tokens[i];
      if (!tok || clauseKeywords.has(tok.toUpperCase())) break;
      // Remove trailing comma
      const hasComma = tok.endsWith(',');
      if (hasComma) tok = tok.slice(0, -1);
      if (!tok) { i++; continue; }

      // Parse schema.name
      const dotParts = tok.split('.');
      let schema: string | null = null;
      let name: string;
      if (dotParts.length >= 2) {
        schema = dotParts[0].replace(/"/g, '');
        name = dotParts[1].replace(/"/g, '');
      } else {
        name = dotParts[0].replace(/"/g, '');
      }

      // Check for alias
      let alias: string | null = null;
      if (!hasComma && i + 1 < tokens.length) {
        const next = tokens[i + 1].replace(/,$/, '');
        const nextUp = next.toUpperCase();
        if (nextUp === 'AS' && i + 2 < tokens.length) {
          alias = tokens[i + 2].replace(/,$/, '').replace(/"/g, '');
          i += 2;
        } else if (!clauseKeywords.has(nextUp) && /^[\w"]+$/.test(next) && next !== ',') {
          alias = next.replace(/"/g, '');
          i++;
        }
      }

      if (name) {
        tables.push({ schema, name, alias });
      }
      i++;
    }
  }
  return tables;
}
