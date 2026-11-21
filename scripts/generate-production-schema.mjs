// Generate an idempotent, non-destructive production schema from schema.sql.
// Run from the repository root: node scripts/generate-production-schema.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'database', 'schema.sql'), 'utf8');

const header = `-- ============================================================================
-- CHSC production schema — idempotent, non-destructive bootstrap
-- Generated from database/schema.sql by scripts/generate-production-schema.mjs.
-- No DROP, no CREATE DATABASE, no USE. Seed rows use INSERT IGNORE so repeated
-- deployments never duplicate or overwrite existing data.
-- ============================================================================

`;

const schema = source
  .replace(/CREATE DATABASE IF NOT EXISTS[\s\S]*?COLLATE utf8mb4_unicode_ci;\s*/, '')
  .replace(/^USE community_health_scheduler;\s*/m, '')
  .replace(/^SET FOREIGN_KEY_CHECKS = [01];\s*/gm, '')
  .replace(/^DROP TABLE IF EXISTS .*;\s*/gm, '')
  .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
  .replace(/INSERT INTO /g, 'INSERT IGNORE INTO ');

writeFileSync(join(root, 'database', 'schema-production.sql'), header + schema);
console.log('Wrote database/schema-production.sql');
