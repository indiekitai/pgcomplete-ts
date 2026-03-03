[English](README.md) | [中文](README.zh-CN.md)

# @indiekitai/pgcomplete

TypeScript/Node.js 的 PostgreSQL 自动补全引擎，从 [pgcli](https://github.com/dbcli/pgcli) 的 `pgcompleter.py` 移植。

## 功能

- **SQL 关键字补全** —— 上下文感知的关键字建议（如 `CREATE` 后建议 `TABLE`）
- **表/视图补全** —— 从数据库建议表和视图，支持 Schema 限定
- **列补全** —— 根据查询 FROM 子句中的表建议列
- **函数补全** —— PostgreSQL 内置函数 + 用户自定义函数
- **Schema 感知** —— 遵循 `search_path`，支持 `schema.table` 写法
- **数据类型补全** —— 内置和自定义类型
- **模糊匹配** —— 输入部分文字即可获得相关建议
- **MCP Server** —— 将补全能力暴露为 AI Agent 的 MCP 工具
- **CLI** —— 交互模式和单次模式，支持 JSON 输出

## 安装

```bash
npm install @indiekitai/pgcomplete
```

## CLI 用法

### 交互模式

```bash
npx @indiekitai/pgcomplete --dsn postgres://user:pass@localhost/mydb
```

### 单次模式

```bash
# 获取查询的补全建议
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT * FROM "

# JSON 输出
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT * FROM " --json

# 指定光标位置
npx @indiekitai/pgcomplete --dsn postgres://... --query "SELECT  FROM users" --cursor 7 --json
```

### 无数据库（仅关键字）

```bash
npx @indiekitai/pgcomplete --query "SEL" --json
```

## 库用法

```typescript
import { PGCompleter, loadMetadata } from '@indiekitai/pgcomplete';

// 创建补全器
const completer = new PGCompleter({ keywordCasing: 'upper' });

// 从数据库加载元数据
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

// 获取补全
const query = 'SELECT * FROM ';
const completions = completer.getCompletions(query, query);
// 返回：[{ text: 'users', type: 'table' }, { text: 'orders', type: 'table' }, ...]
```

## MCP Server

MCP Server 将 SQL 补全暴露为 AI Agent 工具。

### 配置

通过环境变量设置数据库连接：

```bash
export PGCOMPLETE_DSN=postgres://user:pass@localhost/mydb
# 或
export DATABASE_URL=postgres://user:pass@localhost/mydb
```

### 运行

```bash
npx @indiekitai/pgcomplete-mcp
```

### MCP 工具

| 工具 | 描述 |
|------|------|
| `complete` | 获取光标位置的 SQL 自动补全 |
| `list_tables` | 列出所有已知表（可按 Schema 过滤） |
| `list_columns` | 列出指定表的列 |
| `list_functions` | 列出已知数据库函数 |
| `list_schemas` | 列出所有 Schema |

### MCP 配置

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

## API 参考

### `PGCompleter`

核心补全引擎。

```typescript
new PGCompleter(options?: {
  keywordCasing?: 'upper' | 'lower' | 'auto';  // 默认：'upper'
  qualifyColumns?: 'always' | 'never' | 'if_more_than_one_table';
  generateAliases?: boolean;
  searchPathFilter?: boolean;
})
```

#### 方法

- **`getCompletions(text, textBeforeCursor)`** —— 主方法，返回 `CompletionItem[]`
- **`extendDatabases(databases)`** —— 添加数据库名
- **`extendSchemata(schemata)`** —— 添加 Schema 名
- **`setSearchPath(path)`** —— 设置 search path
- **`extendRelations(data, kind)`** —— 添加表或视图
- **`extendColumns(data, kind)`** —— 添加列元数据
- **`extendFunctions(data)`** —— 添加函数元数据
- **`extendDatatypes(data)`** —— 添加自定义数据类型
- **`resetCompletions()`** —— 清除所有元数据

### `CompletionItem`

```typescript
interface CompletionItem {
  text: string;        // 补全文本
  displayText?: string; // 可选的显示文本
  type: string;        // 'keyword' | 'table' | 'column' | 'function' | 'schema' | 'view' | 'database' | 'datatype'
  schema?: string;     // Schema 名（如适用）
  priority?: number;   // 排序优先级（越高越相关）
}
```

### `loadMetadata(connOpts)`

从 PostgreSQL 数据库获取所有元数据。

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

## 致谢

从 [pgcli](https://github.com/dbcli/pgcli) 移植，原作者为 [dbcli](https://github.com/dbcli) 的 Amjith Ramanujam 及贡献者们。

## 许可证

MIT
