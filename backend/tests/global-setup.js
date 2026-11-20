'use strict';

/**
 * Vitest global setup — builds a throwaway MySQL database from
 * database/schema.sql before the suite runs, so integration tests exercise
 * real InnoDB row locks, real unique keys and the real generated column.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config();

function connectionOptions(extra = {}) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    ...extra,
  };
}

module.exports = async function globalSetup() {
  const dbName = process.env.DB_TEST_NAME || 'community_health_scheduler_test';
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: ${dbName}`);
  }

  const root = await mysql.createConnection(connectionOptions());
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await root.query(
      `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
    const sql = fs
      .readFileSync(schemaPath, 'utf8')
      .replaceAll('community_health_scheduler', dbName);

    await root.query(sql);
  } finally {
    await root.end();
  }

  process.env.DB_NAME = dbName;
  process.env.DB_TEST_NAME = dbName;
};
