import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT_DIR, "cloudflare", "d1", "seed.sql");
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TABLES_IN_INSERT_ORDER = [
  "users",
  "sessions",
  "market_quotes",
  "portfolios",
  "accounts",
  "instruments",
  "holdings",
  "portfolio_transactions",
  "position_lots",
  "realized_pnl_ledger",
  "price_snapshots",
  "fx_snapshots",
  "nav_snapshots",
  "corporate_actions",
  "sync_logs",
];

function loadEnvFile(filename) {
  const filePath = path.join(ROOT_DIR, filename);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function sqlEscapeString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatDateOnly(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return SHANGHAI_DATE_FORMATTER.format(date);
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace("T", " ").replace("Z", "").slice(0, 19);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeValue(value, columnType) {
  if (value == null) return "NULL";

  const type = String(columnType || "").toLowerCase();

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (Buffer.isBuffer(value)) {
    return sqlEscapeString(value.toString("utf8"));
  }

  if (type.includes("json")) {
    return sqlEscapeString(typeof value === "string" ? value : JSON.stringify(value));
  }

  if (type === "date") {
    return sqlEscapeString(formatDateOnly(value));
  }

  if (
    type.includes("datetime") ||
    type.includes("timestamp") ||
    type.includes("time")
  ) {
    return sqlEscapeString(formatDateTime(value));
  }

  if (value instanceof Date) {
    return sqlEscapeString(formatDateTime(value));
  }

  if (typeof value === "object") {
    return sqlEscapeString(JSON.stringify(value));
  }

  return sqlEscapeString(value);
}

async function getTableColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
  return rows.map((row) => ({
    name: row.Field,
    type: row.Type,
  }));
}

async function exportTable(connection, tableName) {
  const columns = await getTableColumns(connection, tableName);
  const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);

  if (!rows.length) {
    return {
      tableName,
      rowCount: 0,
      sql: `-- ${tableName}: 0 rows\n`,
    };
  }

  const columnNames = columns.map((column) => `\`${column.name}\``).join(", ");
  const valueLines = rows.map((row) => {
    const values = columns.map((column) => normalizeValue(row[column.name], column.type));
    return `(${values.join(", ")})`;
  });

  const sql = [
    `-- ${tableName}: ${rows.length} rows`,
    `INSERT INTO \`${tableName}\` (${columnNames}) VALUES`,
    `  ${valueLines.join(",\n  ")};`,
    "",
  ].join("\n");

  return {
    tableName,
    rowCount: rows.length,
    sql,
  };
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.example");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "investment_dashboard",
    dateStrings: false,
    decimalNumbers: false,
  });

  try {
    const exportedTables = [];
    for (const tableName of TABLES_IN_INSERT_ORDER) {
      exportedTables.push(await exportTable(connection, tableName));
    }

    const deleteStatements = [...TABLES_IN_INSERT_ORDER]
      .reverse()
      .map((tableName) => `DELETE FROM \`${tableName}\`;`)
      .join("\n");

    const header = [
      "-- Auto-generated from MySQL for Cloudflare D1",
      `-- Generated at: ${new Date().toISOString()}`,
      "",
      "PRAGMA foreign_keys = OFF;",
      "BEGIN TRANSACTION;",
      deleteStatements,
      "",
    ].join("\n");

    const body = exportedTables.map((entry) => entry.sql).join("\n");

    const footer = [
      "COMMIT;",
      "PRAGMA foreign_keys = ON;",
      "",
    ].join("\n");

    await fsp.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fsp.writeFile(OUTPUT_FILE, `${header}${body}${footer}`, "utf8");

    const summary = exportedTables
      .map((entry) => `${entry.tableName}: ${entry.rowCount}`)
      .join(", ");

    console.log(`D1 seed exported to ${OUTPUT_FILE}`);
    console.log(summary);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Failed to export D1 seed");
  console.error(error);
  process.exitCode = 1;
});
