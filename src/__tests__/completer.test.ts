import { describe, it, expect, beforeEach } from 'vitest';
import { PGCompleter } from '../completer.js';

describe('PGCompleter', () => {
  let completer: PGCompleter;

  beforeEach(() => {
    completer = new PGCompleter();
    // Set up some test metadata
    completer.extendSchemata(['public', 'myschema']);
    completer.setSearchPath(['public']);
    completer.extendRelations([
      ['public', 'users'],
      ['public', 'orders'],
      ['public', 'products'],
      ['myschema', 'settings'],
    ], 'tables');
    completer.extendRelations([
      ['public', 'user_view'],
    ], 'views');
    completer.extendColumns([
      ['public', 'users', 'id', 'integer', false, null],
      ['public', 'users', 'name', 'text', false, null],
      ['public', 'users', 'email', 'text', false, null],
      ['public', 'users', 'created_at', 'timestamp', true, 'now()'],
      ['public', 'orders', 'id', 'integer', false, null],
      ['public', 'orders', 'user_id', 'integer', false, null],
      ['public', 'orders', 'total', 'numeric', false, null],
      ['public', 'products', 'id', 'integer', false, null],
      ['public', 'products', 'name', 'text', false, null],
      ['public', 'products', 'price', 'numeric', false, null],
    ], 'tables');
  });

  describe('keyword completions', () => {
    it('should suggest keywords for empty input', () => {
      const result = completer.getCompletions('', '');
      const types = new Set(result.map(r => r.type));
      expect(types.has('keyword')).toBe(true);
    });

    it('should suggest SELECT-related keywords after SELECT', () => {
      const result = completer.getCompletions('SELECT ', 'SELECT ');
      const types = new Set(result.map(r => r.type));
      // Should include columns (from tables in query) and functions
      expect(types.has('keyword')).toBe(true);
    });

    it('should filter keywords by prefix', () => {
      const result = completer.getKeywordMatches('SEL');
      expect(result.some(r => r.text === 'SELECT')).toBe(true);
      expect(result.every(r => r.text.toUpperCase().startsWith('SEL'))).toBe(true);
    });

    it('should respect keyword casing', () => {
      const lower = new PGCompleter({ keywordCasing: 'lower' });
      const result = lower.getKeywordMatches('sel');
      expect(result.some(r => r.text === 'select')).toBe(true);
    });
  });

  describe('table completions', () => {
    it('should suggest tables after FROM', () => {
      const result = completer.getCompletions('SELECT * FROM ', 'SELECT * FROM ');
      const tableNames = result.filter(r => r.type === 'table').map(r => r.text);
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('orders');
      expect(tableNames).toContain('products');
    });

    it('should filter tables by prefix', () => {
      const result = completer.getCompletions('SELECT * FROM us', 'SELECT * FROM us');
      const tableNames = result.filter(r => r.type === 'table').map(r => r.text);
      expect(tableNames).toContain('users');
      // 'orders' and 'products' don't start with 'us' (fuzzy might still match but 'users' should be first)
      expect(tableNames[0]).toBe('users');
    });

    it('should suggest schema-qualified tables', () => {
      const result = completer.getCompletions('SELECT * FROM myschema.', 'SELECT * FROM myschema.');
      const tableNames = result.filter(r => r.type === 'table').map(r => r.text);
      expect(tableNames).toContain('settings');
    });
  });

  describe('column completions', () => {
    it('should suggest columns after SELECT with FROM clause', () => {
      const query = 'SELECT  FROM users';
      const before = 'SELECT ';
      const result = completer.getCompletions(query, before);
      const colNames = result.filter(r => r.type === 'column').map(r => r.text);
      expect(colNames).toContain('id');
      expect(colNames).toContain('name');
      expect(colNames).toContain('email');
    });

    it('should suggest columns after WHERE', () => {
      const query = 'SELECT * FROM users WHERE ';
      const result = completer.getCompletions(query, query);
      const colNames = result.filter(r => r.type === 'column').map(r => r.text);
      expect(colNames).toContain('id');
      expect(colNames).toContain('name');
    });

    it('should filter columns by prefix', () => {
      const query = 'SELECT * FROM users WHERE na';
      const result = completer.getCompletions(query, query);
      const colNames = result.filter(r => r.type === 'column').map(r => r.text);
      expect(colNames).toContain('name');
      expect(colNames).not.toContain('id');
    });
  });

  describe('schema completions', () => {
    it('should suggest schemas after FROM', () => {
      const result = completer.getCompletions('SELECT * FROM ', 'SELECT * FROM ');
      const schemaNames = result.filter(r => r.type === 'schema').map(r => r.text);
      expect(schemaNames).toContain('public');
      expect(schemaNames).toContain('myschema');
    });
  });

  describe('function completions', () => {
    it('should suggest built-in functions in SELECT', () => {
      const result = completer.getCompletions('SELECT cou', 'SELECT cou');
      const funcNames = result.filter(r => r.type === 'function').map(r => r.text.toLowerCase());
      expect(funcNames).toContain('count');
    });
  });

  describe('view completions', () => {
    it('should suggest views after FROM', () => {
      const result = completer.getCompletions('SELECT * FROM ', 'SELECT * FROM ');
      const viewNames = result.filter(r => r.type === 'view').map(r => r.text);
      expect(viewNames).toContain('user_view');
    });
  });

  describe('database completions', () => {
    it('should suggest databases', () => {
      completer.extendDatabases(['postgres', 'mydb', 'testdb']);
      const result = completer.getDatabaseMatches('my');
      expect(result.some(r => r.text === 'mydb')).toBe(true);
    });
  });

  describe('datatype completions', () => {
    it('should suggest built-in datatypes', () => {
      const result = completer.getDatatypeMatches('int', null);
      const dtNames = result.map(r => r.text.toLowerCase());
      expect(dtNames.some(d => d.startsWith('int'))).toBe(true);
    });
  });

  describe('context-aware suggestions', () => {
    it('should suggest tables after UPDATE', () => {
      const result = completer.getCompletions('UPDATE ', 'UPDATE ');
      const tableNames = result.filter(r => r.type === 'table').map(r => r.text);
      expect(tableNames).toContain('users');
    });

    it('should suggest tables after INSERT INTO', () => {
      const result = completer.getCompletions('INSERT INTO ', 'INSERT INTO ');
      const tableNames = result.filter(r => r.type === 'table').map(r => r.text);
      expect(tableNames).toContain('users');
    });

    it('should suggest keywords after CREATE', () => {
      const result = completer.getCompletions('CREATE ', 'CREATE ');
      const types = new Set(result.map(r => r.type));
      expect(types.has('keyword')).toBe(true);
    });
  });
});
