/**
 * Database Module - Neon PostgreSQL (Multi-Tenant)
 * Maneja conexión y operaciones CRUD para tenants, inboxes, users y asignaciones
 */

const { Pool } = require('pg');
require('dotenv').config();

// Pool de conexiones
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to Neon PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

/**
 * Inicializa las tablas en la base de datos
 */
async function initializeDatabase() {
  const client = await pool.connect();

  try {
    // Tabla de tenants
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

    // Tabla de inboxes (shared mailboxes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS inboxes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        tenant_id INTEGER REFERENCES tenants(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de users (teammates)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        teammate_id VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(200) NOT NULL,
        is_individual BOOLEAN DEFAULT FALSE,
        tenant_id INTEGER REFERENCES tenants(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de relación user_inbox (many-to-many)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_inbox (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        inbox_id INTEGER REFERENCES inboxes(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, inbox_id)
      )
    `);

    // Tabla de system_users (usuarios con acceso al sistema - autenticación)
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'super_admin')),
        is_active BOOLEAN DEFAULT TRUE,
        azure_oid VARCHAR(100),
        tenant_id INTEGER REFERENCES tenants(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Índices para mejor rendimiento
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_teammate_id ON users(teammate_id);
      CREATE INDEX IF NOT EXISTS idx_inboxes_code ON inboxes(code);
      CREATE INDEX IF NOT EXISTS idx_user_inbox_user ON user_inbox(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_inbox_inbox ON user_inbox(inbox_id);
      CREATE INDEX IF NOT EXISTS idx_system_users_email ON system_users(email);
      CREATE INDEX IF NOT EXISTS idx_system_users_azure_oid ON system_users(azure_oid);
      CREATE INDEX IF NOT EXISTS idx_inboxes_tenant_id ON inboxes(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_system_users_tenant_id ON system_users(tenant_id);
    `);

    console.log('Database tables initialized successfully');
  } finally {
    client.release();
  }
}

// ==========================================
// TENANT CRUD OPERATIONS
// ==========================================

async function getAllTenants() {
  const result = await pool.query(
    'SELECT * FROM tenants ORDER BY name'
  );
  return result.rows;
}

async function getActiveTenants() {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE is_active = TRUE ORDER BY name'
  );
  return result.rows;
}

async function getTenantById(id) {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

async function getTenantBySlug(slug) {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE slug = $1',
    [slug]
  );
  return result.rows[0];
}

async function createTenant(name, slug, domain = null, azureTenantId = null) {
  const result = await pool.query(
    `INSERT INTO tenants (name, slug, domain, azure_tenant_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, slug, domain, azureTenantId]
  );
  return result.rows[0];
}

async function updateTenant(id, name, slug, domain, azureTenantId, isActive) {
  const result = await pool.query(
    `UPDATE tenants
     SET name = $2, slug = $3, domain = $4, azure_tenant_id = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, name, slug, domain, azureTenantId, isActive]
  );
  return result.rows[0];
}

async function deleteTenant(id) {
  const result = await pool.query(
    'DELETE FROM tenants WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

async function setTenantApiKeys(id, frontApiKey, frontApiKeyIndividuals, frontEndpoint) {
  const result = await pool.query(
    `UPDATE tenants
     SET front_api_key = $2, front_api_key_individuals = $3, front_endpoint = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, frontApiKey, frontApiKeyIndividuals, frontEndpoint]
  );
  return result.rows[0];
}

async function getTenantApiKeys(id) {
  const result = await pool.query(
    'SELECT id, front_api_key, front_api_key_individuals, front_endpoint FROM tenants WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

// ==========================================
// INBOX CRUD OPERATIONS (Tenant-Scoped)
// ==========================================

async function getAllInboxes(tenantId) {
  const result = await pool.query(`
    SELECT i.*, COUNT(ui.user_id) as user_count
    FROM inboxes i
    LEFT JOIN user_inbox ui ON i.id = ui.inbox_id
    WHERE i.tenant_id = $1
    GROUP BY i.id
    ORDER BY i.name
  `, [tenantId]);
  return result.rows;
}

async function getInboxByCode(code, tenantId) {
  const result = await pool.query(
    'SELECT * FROM inboxes WHERE code = $1 AND tenant_id = $2',
    [code, tenantId]
  );
  return result.rows[0];
}

async function getInboxById(id, tenantId) {
  const result = await pool.query(
    'SELECT * FROM inboxes WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return result.rows[0];
}

async function createInbox(code, name, description = null, tenantId) {
  const result = await pool.query(
    `INSERT INTO inboxes (code, name, description, tenant_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [code, name, description, tenantId]
  );
  return result.rows[0];
}

async function updateInbox(id, code, name, description, tenantId) {
  const result = await pool.query(
    `UPDATE inboxes
     SET code = $2, name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND tenant_id = $5
     RETURNING *`,
    [id, code, name, description, tenantId]
  );
  return result.rows[0];
}

async function deleteInbox(id, tenantId) {
  const result = await pool.query(
    'DELETE FROM inboxes WHERE id = $1 AND tenant_id = $2 RETURNING *',
    [id, tenantId]
  );
  return result.rows[0];
}

// ==========================================
// USER CRUD OPERATIONS (Tenant-Scoped)
// ==========================================

async function getAllUsers(tenantId) {
  const result = await pool.query(`
    SELECT u.*,
           COALESCE(json_agg(
             json_build_object('inbox_id', i.id, 'inbox_name', i.name, 'inbox_code', i.code)
           ) FILTER (WHERE i.id IS NOT NULL), '[]') as inboxes
    FROM users u
    LEFT JOIN user_inbox ui ON u.id = ui.user_id
    LEFT JOIN inboxes i ON ui.inbox_id = i.id
    WHERE u.tenant_id = $1
    GROUP BY u.id
    ORDER BY u.name
  `, [tenantId]);
  return result.rows;
}

async function getUserByTeammateId(teammateId, tenantId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE teammate_id = $1 AND tenant_id = $2',
    [teammateId, tenantId]
  );
  return result.rows[0];
}

async function getUserById(id, tenantId) {
  const result = await pool.query(`
    SELECT u.*,
           COALESCE(json_agg(
             json_build_object('inbox_id', i.id, 'inbox_name', i.name, 'inbox_code', i.code)
           ) FILTER (WHERE i.id IS NOT NULL), '[]') as inboxes
    FROM users u
    LEFT JOIN user_inbox ui ON u.id = ui.user_id
    LEFT JOIN inboxes i ON ui.inbox_id = i.id
    WHERE u.id = $1 AND u.tenant_id = $2
    GROUP BY u.id
  `, [id, tenantId]);
  return result.rows[0];
}

async function createUser(teammateId, email, name, isIndividual = false, tenantId) {
  const result = await pool.query(
    `INSERT INTO users (teammate_id, email, name, is_individual, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [teammateId, email, name, isIndividual, tenantId]
  );
  return result.rows[0];
}

async function updateUser(id, teammateId, email, name, isIndividual, tenantId) {
  const result = await pool.query(
    `UPDATE users
     SET teammate_id = $2, email = $3, name = $4, is_individual = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND tenant_id = $6
     RETURNING *`,
    [id, teammateId, email, name, isIndividual, tenantId]
  );
  return result.rows[0];
}

async function deleteUser(id, tenantId) {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 AND tenant_id = $2 RETURNING *',
    [id, tenantId]
  );
  return result.rows[0];
}

// ==========================================
// USER-INBOX ASSIGNMENT OPERATIONS
// ==========================================

async function assignUserToInbox(userId, inboxId) {
  const result = await pool.query(
    `INSERT INTO user_inbox (user_id, inbox_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, inbox_id) DO NOTHING
     RETURNING *`,
    [userId, inboxId]
  );
  return result.rows[0];
}

async function removeUserFromInbox(userId, inboxId) {
  const result = await pool.query(
    'DELETE FROM user_inbox WHERE user_id = $1 AND inbox_id = $2 RETURNING *',
    [userId, inboxId]
  );
  return result.rows[0];
}

async function getUsersByInbox(inboxId) {
  const result = await pool.query(`
    SELECT u.*
    FROM users u
    INNER JOIN user_inbox ui ON u.id = ui.user_id
    WHERE ui.inbox_id = $1
    ORDER BY u.name
  `, [inboxId]);
  return result.rows;
}

async function getUsersByInboxName(inboxName, tenantId) {
  const result = await pool.query(`
    SELECT u.teammate_id as id, u.email, u.name, i.name as inbox, i.code
    FROM users u
    INNER JOIN user_inbox ui ON u.id = ui.user_id
    INNER JOIN inboxes i ON ui.inbox_id = i.id
    WHERE i.name = $1 AND i.tenant_id = $2
    ORDER BY u.name
  `, [inboxName, tenantId]);
  return result.rows;
}

async function getIndividualUsers(tenantId) {
  const result = await pool.query(`
    SELECT teammate_id as id, email, name
    FROM users
    WHERE is_individual = TRUE AND tenant_id = $1
    ORDER BY name
  `, [tenantId]);
  return result.rows;
}

// ==========================================
// SYSTEM USER CRUD OPERATIONS (Authentication)
// ==========================================

// Auth lookups stay cross-tenant (needed for login)
async function getSystemUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM system_users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0];
}

async function getSystemUserById(id) {
  const result = await pool.query(
    'SELECT * FROM system_users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

async function getSystemUserByAzureOid(azureOid) {
  const result = await pool.query(
    'SELECT * FROM system_users WHERE azure_oid = $1',
    [azureOid]
  );
  return result.rows[0];
}

// Scoped: tenant admin sees own tenant, super admin sees all
async function getAllSystemUsers(tenantId) {
  if (tenantId === null || tenantId === undefined) {
    // Super admin: see all
    const result = await pool.query(`
      SELECT su.*, t.name as tenant_name
      FROM system_users su
      LEFT JOIN tenants t ON su.tenant_id = t.id
      ORDER BY su.name
    `);
    return result.rows;
  }
  // Tenant admin: see own tenant only
  const result = await pool.query(
    'SELECT * FROM system_users WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
  return result.rows;
}

async function createSystemUser(email, name, role = 'user', azureOid = null, tenantId = null) {
  const result = await pool.query(
    `INSERT INTO system_users (email, name, role, azure_oid, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [email, name, role, azureOid, tenantId]
  );
  return result.rows[0];
}

async function updateSystemUser(id, email, name, role, isActive) {
  const result = await pool.query(
    `UPDATE system_users
     SET email = $2, name = $3, role = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, email, name, role, isActive]
  );
  return result.rows[0];
}

async function updateSystemUserTenant(id, tenantId) {
  const result = await pool.query(
    `UPDATE system_users
     SET tenant_id = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, tenantId]
  );
  return result.rows[0];
}

async function updateSystemUserAzureOid(id, azureOid) {
  const result = await pool.query(
    `UPDATE system_users
     SET azure_oid = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, azureOid]
  );
  return result.rows[0];
}

async function deleteSystemUser(id) {
  const result = await pool.query(
    'DELETE FROM system_users WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

// ==========================================
// MIGRATION HELPER
// ==========================================

async function migrateFromJSON(usersData, individualUsersData) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Extraer inboxes únicos de los datos
    const inboxMap = new Map();
    usersData.forEach(user => {
      if (!inboxMap.has(user.code)) {
        inboxMap.set(user.code, user.inbox);
      }
    });

    // Insertar inboxes
    for (const [code, name] of inboxMap) {
      await client.query(
        `INSERT INTO inboxes (code, name)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = $2`,
        [code, name]
      );
    }

    // Insertar usuarios únicos de users.json
    const userMap = new Map();
    for (const userData of usersData) {
      if (!userMap.has(userData.id)) {
        const userResult = await client.query(
          `INSERT INTO users (teammate_id, email, name, is_individual)
           VALUES ($1, $2, $3, FALSE)
           ON CONFLICT (teammate_id) DO UPDATE SET email = $2, name = $3
           RETURNING id`,
          [userData.id, userData.email, userData.name]
        );
        userMap.set(userData.id, userResult.rows[0].id);
      }
    }

    // Insertar usuarios individuales
    for (const userData of individualUsersData) {
      if (!userMap.has(userData.id)) {
        const userResult = await client.query(
          `INSERT INTO users (teammate_id, email, name, is_individual)
           VALUES ($1, $2, $3, TRUE)
           ON CONFLICT (teammate_id) DO UPDATE SET email = $2, name = $3, is_individual = TRUE
           RETURNING id`,
          [userData.id, userData.email, userData.name]
        );
        userMap.set(userData.id, userResult.rows[0].id);
      } else {
        // Marcar como individual si ya existe
        await client.query(
          `UPDATE users SET is_individual = TRUE WHERE teammate_id = $1`,
          [userData.id]
        );
      }
    }

    // Crear relaciones user_inbox
    for (const userData of usersData) {
      const userId = userMap.get(userData.id);
      const inboxResult = await client.query(
        'SELECT id FROM inboxes WHERE code = $1',
        [userData.code]
      );
      if (inboxResult.rows[0]) {
        await client.query(
          `INSERT INTO user_inbox (user_id, inbox_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, inbox_id) DO NOTHING`,
          [userId, inboxResult.rows[0].id]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully');

    return {
      inboxes: inboxMap.size,
      users: userMap.size,
      assignments: usersData.length
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  pool,
  initializeDatabase,
  // Tenants
  getAllTenants,
  getActiveTenants,
  getTenantById,
  getTenantBySlug,
  createTenant,
  updateTenant,
  deleteTenant,
  setTenantApiKeys,
  getTenantApiKeys,
  // Inboxes
  getAllInboxes,
  getInboxByCode,
  getInboxById,
  createInbox,
  updateInbox,
  deleteInbox,
  // Users
  getAllUsers,
  getUserByTeammateId,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  // Assignments
  assignUserToInbox,
  removeUserFromInbox,
  getUsersByInbox,
  getUsersByInboxName,
  getIndividualUsers,
  // System Users (Authentication)
  getSystemUserByEmail,
  getSystemUserById,
  getSystemUserByAzureOid,
  getAllSystemUsers,
  createSystemUser,
  updateSystemUser,
  updateSystemUserTenant,
  updateSystemUserAzureOid,
  deleteSystemUser,
  // Migration
  migrateFromJSON
};
