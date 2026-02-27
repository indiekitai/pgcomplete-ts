import { describe, it, expect } from 'vitest';
import { lastWord, generateAlias, extractTables, normalizeRef } from '../utils.js';

describe('lastWord', () => {
  it('returns empty for empty string', () => expect(lastWord('')).toBe(''));
  it('returns empty for trailing space', () => expect(lastWord('abc ')).toBe(''));
  it('returns last word', () => expect(lastWord('abc def')).toBe('def'));
  it('returns full string if single word', () => expect(lastWord('abc')).toBe('abc'));
  it('handles most_punctuations', () => {
    expect(lastWord('schema.table', 'most_punctuations')).toBe('table');
    expect(lastWord('"foo*bar', 'most_punctuations')).toBe('"foo*bar');
  });
});

describe('generateAlias', () => {
  it('uses uppercase letters', () => expect(generateAlias('MyTable')).toBe('MT'));
  it('uses first + after underscores', () => expect(generateAlias('my_table')).toBe('mt'));
  it('uses alias map', () => expect(generateAlias('users', { users: 'u' })).toBe('u'));
});

describe('normalizeRef', () => {
  it('lowercases unquoted', () => expect(normalizeRef('Foo')).toBe('"foo"'));
  it('keeps quoted as-is', () => expect(normalizeRef('"Foo"')).toBe('"Foo"'));
});

describe('extractTables', () => {
  it('extracts simple FROM table', () => {
    const tables = extractTables('SELECT * FROM users');
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('users');
  });

  it('extracts schema-qualified table', () => {
    const tables = extractTables('SELECT * FROM myschema.users');
    expect(tables[0].schema).toBe('myschema');
    expect(tables[0].name).toBe('users');
  });

  it('extracts aliased table', () => {
    const tables = extractTables('SELECT * FROM users u');
    expect(tables[0].alias).toBe('u');
  });

  it('extracts JOIN tables', () => {
    const tables = extractTables('SELECT * FROM users u JOIN orders o ON u.id = o.user_id');
    expect(tables.length).toBeGreaterThanOrEqual(2);
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('orders');
  });
});
