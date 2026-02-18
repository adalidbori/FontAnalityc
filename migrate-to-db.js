/**
 * Script de migración - JSON a PostgreSQL
 * Migra datos de users.json e individual_inbox.json a Neon PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  console.log('========================================');
  console.log('Starting migration to PostgreSQL');
  console.log('========================================\n');

  try {
    // 1. Inicializar tablas
    console.log('1. Initializing database tables...');
    await db.initializeDatabase();
    console.log('   ✅ Tables created\n');

    // 2. Leer archivos JSON
    console.log('2. Reading JSON files...');

    const usersFile = path.join(__dirname, 'public', 'users.json');
    const individualFile = path.join(__dirname, 'public', 'individual_inbox.json');

    const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const individualData = JSON.parse(fs.readFileSync(individualFile, 'utf8'));

    console.log(`   Found ${usersData.length} user-inbox assignments`);
    console.log(`   Found ${individualData.length} individual users\n`);

    // 3. Migrar datos
    console.log('3. Migrating data to PostgreSQL...');
    const result = await db.migrateFromJSON(usersData, individualData);

    console.log(`   ✅ Created ${result.inboxes} inboxes`);
    console.log(`   ✅ Created ${result.users} users`);
    console.log(`   ✅ Created ${result.assignments} user-inbox assignments\n`);

    // 4. Verificar datos
    console.log('4. Verifying migrated data...\n');

    const inboxes = await db.getAllInboxes();
    console.log('   INBOXES:');
    console.log('   ─────────────────────────────────────');
    inboxes.forEach(inbox => {
      console.log(`   ${inbox.name.padEnd(20)} | ${inbox.code} | ${inbox.user_count} users`);
    });

    console.log('\n   INDIVIDUAL USERS:');
    console.log('   ─────────────────────────────────────');
    const individuals = await db.getIndividualUsers();
    individuals.forEach(user => {
      console.log(`   ${user.name.padEnd(25)} | ${user.email}`);
    });

    console.log('\n========================================');
    console.log('Migration completed successfully!');
    console.log('========================================\n');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

migrate();
