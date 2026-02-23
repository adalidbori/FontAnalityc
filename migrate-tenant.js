/**
 * Migration Script - Convert single-tenant data to multi-tenant (Tenant #1)
 *
 * Usage:
 *   node migrate-tenant.js --email=owner@acustoms.com
 *
 * This script:
 * 1. Creates the tenants table
 * 2. Inserts Tenant #1 from current env vars
 * 3. Extends system_users.role CHECK to allow 'super_admin'
 * 4. Adds tenant_id column to inboxes, users, system_users
 * 5. Sets tenant_id = 1 for all existing rows
 * 6. Promotes the specified email to super_admin (tenant_id = NULL)
 * 7. Updates unique constraints for multi-tenant
 * 8. Creates indexes on tenant_id columns
 * 9. Renames existing cache files with tenant slug prefix
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Parse CLI args
const args = process.argv.slice(2);
const emailArg = args.find(a => a.startsWith('--email='));
const superAdminEmail = emailArg ? emailArg.split('=')[1] : null;

if (!superAdminEmail) {
  console.error('Usage: node migrate-tenant.js --email=owner@acustoms.com');
  console.error('  --email: Email of the user to promote to super_admin');
  process.exit(1);
}

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const TENANT_SLUG = 'a-customs-brokerage';

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('=== Multi-Tenant Migration ===\n');

    // ─── Step 1: Create tenants table ───
    console.log('Step 1: Creating tenants table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        domain VARCHAR(255),
        azure_tenant_id VARCHAR(100),
        front_api_key TEXT,
        front_api_key_individuals TEXT,
        front_endpoint VARCHAR(500) DEFAULT 'https://api2.frontapp.com/analytics/reports',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  tenants table created.');

    // ─── Step 2: Insert Tenant #1 from env vars ───
    console.log('\nStep 2: Inserting Tenant #1...');
    const existingTenant = await client.query('SELECT id FROM tenants WHERE slug = $1', [TENANT_SLUG]);

    if (existingTenant.rows.length === 0) {
      await client.query(`
        INSERT INTO tenants (id, name, slug, domain, front_api_key, front_api_key_individuals, front_endpoint)
        VALUES (1, 'A Customs Brokerage', $1, 'acustoms.com', $2, $3, $4)
      `, [
        TENANT_SLUG,
        process.env.FRONT_API_KEY || null,
        process.env.FRONT_API_KEY_INDIVIDUALS || null,
        process.env.ENDPOINT || 'https://api2.frontapp.com/analytics/reports'
      ]);
      // Reset sequence to continue after id=1
      await client.query("SELECT setval('tenants_id_seq', (SELECT MAX(id) FROM tenants))");
      console.log('  Tenant #1 "A Customs Brokerage" inserted.');
    } else {
      console.log('  Tenant #1 already exists, skipping.');
    }

    // ─── Step 3: Extend system_users.role CHECK to allow 'super_admin' ───
    console.log('\nStep 3: Extending system_users.role CHECK...');
    // Drop old check and add new one
    await client.query(`
      ALTER TABLE system_users DROP CONSTRAINT IF EXISTS system_users_role_check
    `);
    await client.query(`
      ALTER TABLE system_users ADD CONSTRAINT system_users_role_check
      CHECK (role IN ('admin', 'user', 'super_admin'))
    `);
    console.log('  role CHECK now allows super_admin.');

    // ─── Step 4: Add tenant_id column to inboxes, users, system_users ───
    console.log('\nStep 4: Adding tenant_id columns...');

    // Check if columns already exist before adding
    const colCheck = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('inboxes', 'users', 'system_users')
        AND column_name = 'tenant_id'
    `);
    const existingCols = new Set(colCheck.rows.map(r => r.table_name));

    if (!existingCols.has('inboxes')) {
      await client.query('ALTER TABLE inboxes ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1');
      console.log('  Added tenant_id to inboxes.');
    } else {
      console.log('  inboxes.tenant_id already exists.');
    }

    if (!existingCols.has('users')) {
      await client.query('ALTER TABLE users ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1');
      console.log('  Added tenant_id to users.');
    } else {
      console.log('  users.tenant_id already exists.');
    }

    if (!existingCols.has('system_users')) {
      await client.query('ALTER TABLE system_users ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)');
      console.log('  Added tenant_id to system_users.');
    } else {
      console.log('  system_users.tenant_id already exists.');
    }

    // ─── Step 5: Set tenant_id = 1 for all existing rows ───
    console.log('\nStep 5: Setting tenant_id = 1 for existing rows...');
    const r1 = await client.query('UPDATE inboxes SET tenant_id = 1 WHERE tenant_id IS NULL');
    const r2 = await client.query('UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL');
    const r3 = await client.query('UPDATE system_users SET tenant_id = 1 WHERE tenant_id IS NULL');
    console.log(`  Updated: ${r1.rowCount} inboxes, ${r2.rowCount} users, ${r3.rowCount} system_users.`);

    // ─── Step 6: Promote the specified user to super_admin ───
    console.log(`\nStep 6: Promoting ${superAdminEmail} to super_admin...`);
    const userResult = await client.query(
      'SELECT id, email, name, role FROM system_users WHERE LOWER(email) = LOWER($1)',
      [superAdminEmail]
    );

    if (userResult.rows.length === 0) {
      console.error(`  ERROR: User with email "${superAdminEmail}" not found in system_users.`);
      console.error('  Please create the user first, then re-run this migration.');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    const superAdmin = userResult.rows[0];
    await client.query(
      "UPDATE system_users SET role = 'super_admin', tenant_id = NULL WHERE id = $1",
      [superAdmin.id]
    );
    console.log(`  ${superAdmin.name} (${superAdmin.email}) promoted to super_admin with tenant_id = NULL.`);

    // ─── Step 7: Update unique constraints for multi-tenant ───
    console.log('\nStep 7: Updating unique constraints...');

    // Drop old unique constraints
    await client.query('ALTER TABLE inboxes DROP CONSTRAINT IF EXISTS inboxes_code_key');
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_teammate_id_key');

    // Add new composite unique constraints
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'inboxes_code_tenant_id_unique'
        ) THEN
          ALTER TABLE inboxes ADD CONSTRAINT inboxes_code_tenant_id_unique UNIQUE (code, tenant_id);
        END IF;
      END $$
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_teammate_id_tenant_id_unique'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_teammate_id_tenant_id_unique UNIQUE (teammate_id, tenant_id);
        END IF;
      END $$
    `);
    console.log('  Unique constraints updated: inboxes(code, tenant_id), users(teammate_id, tenant_id).');

    // ─── Step 8: Create indexes on tenant_id columns ───
    console.log('\nStep 8: Creating indexes...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_inboxes_tenant_id ON inboxes(tenant_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_system_users_tenant_id ON system_users(tenant_id)');
    console.log('  Indexes created.');

    await client.query('COMMIT');
    console.log('\n=== Database migration committed successfully ===\n');

    // ─── Step 9: Rename existing cache files ───
    console.log('Step 9: Renaming cache files...');
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
      let renamed = 0;

      for (const file of files) {
        // Skip files already prefixed
        if (file.startsWith(`${TENANT_SLUG}_`)) {
          console.log(`  Skipping already prefixed: ${file}`);
          continue;
        }

        const oldPath = path.join(CACHE_DIR, file);
        const newPath = path.join(CACHE_DIR, `${TENANT_SLUG}_${file}`);
        fs.renameSync(oldPath, newPath);
        console.log(`  Renamed: ${file} -> ${TENANT_SLUG}_${file}`);
        renamed++;
      }

      console.log(`  ${renamed} files renamed.`);
    } else {
      console.log('  No cache directory found, skipping.');
    }

    console.log('\n=== Migration complete! ===');
    console.log('\nSummary:');
    console.log(`  - Tenant #1: "A Customs Brokerage" (slug: ${TENANT_SLUG})`);
    console.log(`  - Super Admin: ${superAdmin.name} (${superAdmin.email})`);
    console.log('  - All existing data assigned to Tenant #1');
    console.log('  - Cache files prefixed with tenant slug');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\nMigration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
