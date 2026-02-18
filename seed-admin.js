/**
 * Seed script to create the first admin user
 *
 * Usage: node seed-admin.js <email> <name>
 * Example: node seed-admin.js admin@company.com "Admin User"
 *
 * This script creates a system user with admin role that can access
 * the application after authenticating with Microsoft O365.
 */

require('dotenv').config();
const db = require('./db');

async function seedAdmin() {
  const email = process.argv[2];
  const name = process.argv[3];

  if (!email || !name) {
    console.error('Usage: node seed-admin.js <email> <name>');
    console.error('Example: node seed-admin.js admin@company.com "Admin User"');
    process.exit(1);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error('Error: Invalid email format');
    process.exit(1);
  }

  try {
    // Initialize database (creates tables if they don't exist)
    console.log('Initializing database...');
    await db.initializeDatabase();

    // Check if user already exists
    const existingUser = await db.getSystemUserByEmail(email);
    if (existingUser) {
      console.log(`\nUser ${email} already exists:`);
      console.log(`  ID: ${existingUser.id}`);
      console.log(`  Name: ${existingUser.name}`);
      console.log(`  Role: ${existingUser.role}`);
      console.log(`  Active: ${existingUser.is_active}`);

      if (existingUser.role !== 'admin') {
        // Upgrade to admin
        const updated = await db.updateSystemUser(
          existingUser.id,
          existingUser.email,
          existingUser.name,
          'admin',
          true
        );
        console.log(`\nUser ${email} has been upgraded to admin role`);
      }
      process.exit(0);
    }

    // Create admin user
    const user = await db.createSystemUser(email, name, 'admin');

    console.log('\n========================================');
    console.log('Admin user created successfully!');
    console.log('========================================');
    console.log(`  ID:    ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Name:  ${user.name}`);
    console.log(`  Role:  ${user.role}`);
    console.log('========================================');
    console.log('\nThis user can now login with their Microsoft O365 account.');
    console.log('Make sure the email matches their O365 account email.');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exit(1);
  }
}

seedAdmin();
