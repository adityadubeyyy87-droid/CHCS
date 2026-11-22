'use strict';

/**
 * Shared MySQL connection configuration.
 *
 * Local development uses DB_HOST/DB_PORT/DB_USER/... . Hosted providers such as
 * Railway inject a single MYSQL_URL or DATABASE_URL, so parse that when present
 * and let the explicit DB_* variables win. This keeps the local development workflow
 * unchanged while making the same backend deployable without credentials in
 * the repository.
 */

function parseUrl(raw) {
  if (!raw || !/^(mysql|mariadb):\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return {
      host: decodeURIComponent(url.hostname),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined,
      sslWanted: ['true', '1', 'yes'].includes((url.searchParams.get('ssl') || '').toLowerCase()),
    };
  } catch {
    return null;
  }
}

function wantsSsl() {
  const raw = String(process.env.DB_SSL || '').toLowerCase();
  return ['true', '1', 'yes'].includes(raw);
}

function dbConnectionOptions(extra = {}) {
  const fromUrl = parseUrl(process.env.MYSQL_URL || process.env.DATABASE_URL);
  const ssl = wantsSsl() || Boolean(fromUrl?.sslWanted);
  return {
    host: process.env.DB_HOST || fromUrl?.host || '127.0.0.1',
    port: Number(process.env.DB_PORT || fromUrl?.port || 3306),
    user: process.env.DB_USER || fromUrl?.user || 'root',
    password: process.env.DB_PASSWORD ?? fromUrl?.password ?? '',
    database: process.env.DB_NAME || fromUrl?.database || 'community_health_scheduler',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 20),
    queueLimit: 0,
    enableKeepAlive: true,
    decimalNumbers: true,
    timezone: 'local',
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    ...extra,
  };
}

module.exports = { dbConnectionOptions, parseUrl };
