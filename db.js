/**
 * Database Module - Neon PostgreSQL
 * Maneja conexión y operaciones CRUD para inboxes, users y asignaciones
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
    // Tabla de inboxes (shared mailboxes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS inboxes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de users (teammates)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        teammate_id VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(200) NOT NULL,
        is_individual BOOLEAN DEFAULT FALSE,
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

    // Índices para mejor rendimiento
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_teammate_id ON users(teammate_id);
      CREATE INDEX IF NOT EXISTS idx_inboxes_code ON inboxes(code);
      CREATE INDEX IF NOT EXISTS idx_user_inbox_user ON user_inbox(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_inbox_inbox ON user_inbox(inbox_id);
    `);

    console.log('Database tables initialized successfully');
  } finally {
    client.release();
  }
}

// ==========================================
// INBOX CRUD OPERATIONS
// ==========================================

async function getAllInboxes() {
  const result = await pool.query(`
    SELECT i.*, COUNT(ui.user_id) as user_count
    FROM inboxes i
    LEFT JOIN user_inbox ui ON i.id = ui.inbox_id
    GROUP BY i.id
    ORDER BY i.name
  `);
  return result.rows;
}

async function getInboxByCode(code) {
  const result = await pool.query(
    'SELECT * FROM inboxes WHERE code = $1',
    [code]
  );
  return result.rows[0];
}

async function getInboxById(id) {
  const result = await pool.query(
    'SELECT * FROM inboxes WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

async function createInbox(code, name, description = null) {
  const result = await pool.query(
    `INSERT INTO inboxes (code, name, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [code, name, description]
  );
  return result.rows[0];
}

async function updateInbox(id, code, name, description) {
  const result = await pool.query(
    `UPDATE inboxes
     SET code = $2, name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, code, name, description]
  );
  return result.rows[0];
}

async function deleteInbox(id) {
  const result = await pool.query(
    'DELETE FROM inboxes WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

// ==========================================
// USER CRUD OPERATIONS
// ==========================================

async function getAllUsers() {
  const result = await pool.query(`
    SELECT u.*,
           COALESCE(json_agg(
             json_build_object('inbox_id', i.id, 'inbox_name', i.name, 'inbox_code', i.code)
           ) FILTER (WHERE i.id IS NOT NULL), '[]') as inboxes
    FROM users u
    LEFT JOIN user_inbox ui ON u.id = ui.user_id
    LEFT JOIN inboxes i ON ui.inbox_id = i.id
    GROUP BY u.id
    ORDER BY u.name
  `);
  return result.rows;
}

async function getUserByTeammateId(teammateId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE teammate_id = $1',
    [teammateId]
  );
  return result.rows[0];
}

async function getUserById(id) {
  const result = await pool.query(`
    SELECT u.*,
           COALESCE(json_agg(
             json_build_object('inbox_id', i.id, 'inbox_name', i.name, 'inbox_code', i.code)
           ) FILTER (WHERE i.id IS NOT NULL), '[]') as inboxes
    FROM users u
    LEFT JOIN user_inbox ui ON u.id = ui.user_id
    LEFT JOIN inboxes i ON ui.inbox_id = i.id
    WHERE u.id = $1
    GROUP BY u.id
  `, [id]);
  return result.rows[0];
}

async function createUser(teammateId, email, name, isIndividual = false) {
  const result = await pool.query(
    `INSERT INTO users (teammate_id, email, name, is_individual)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [teammateId, email, name, isIndividual]
  );
  return result.rows[0];
}

async function updateUser(id, teammateId, email, name, isIndividual) {
  const result = await pool.query(
    `UPDATE users
     SET teammate_id = $2, email = $3, name = $4, is_individual = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, teammateId, email, name, isIndividual]
  );
  return result.rows[0];
}

async function deleteUser(id) {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING *',
    [id]
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

async function getUsersByInboxName(inboxName) {
  const result = await pool.query(`
    SELECT u.teammate_id as id, u.email, u.name, i.name as inbox, i.code
    FROM users u
    INNER JOIN user_inbox ui ON u.id = ui.user_id
    INNER JOIN inboxes i ON ui.inbox_id = i.id
    WHERE i.name = $1
    ORDER BY u.name
  `, [inboxName]);
  return result.rows;
}

async function getIndividualUsers() {
  const result = await pool.query(`
    SELECT teammate_id as id, email, name
    FROM users
    WHERE is_individual = TRUE
    ORDER BY name
  `);
  return result.rows;
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
  // Migration
  migrateFromJSON
};
