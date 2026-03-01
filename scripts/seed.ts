/**
 * Seed: create first organization and optional super_admin.
 * Run: npm run seed (from backend folder)
 *
 * To create super_admin, set env vars BEFORE the command:
 *   PowerShell: $env:SUPER_ADMIN_EMAIL="you@example.com"; $env:SUPER_ADMIN_PASSWORD="yourpass"; npm run seed
 *   CMD:        set SUPER_ADMIN_EMAIL=you@example.com && set SUPER_ADMIN_PASSWORD=yourpass && npm run seed
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { config } from '../src/config';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';

import dns from 'dns';

async function seed() {
  if (config.MONGODB_URI.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }
  await mongoose.connect(config.MONGODB_URI);
  const existing = await Organization.findOne({ slug: 'platform' });
  if (existing) {
    console.log('Organization "platform" already exists. Login code:', existing.slug, '| ID:', existing._id.toString());
  } else {
    const org = await Organization.create({
      name: 'Platform',
      slug: 'platform',
      status: 'active',
      settings: { allowRegistration: true },
    });
    console.log('Created organization:', org.name, '| Login code:', org.slug);
  }
  const org = await Organization.findOne({ slug: 'platform' });
  if (!org) {
    console.error('No organization found');
    process.exit(1);
  }
  const orgId = org._id.toString();
  console.log('Use organization code "' + org.slug + '" to sign in or register (not the long ID).');
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (email && password) {
    const found = await User.findOne({ organizationId: orgId, email });
    if (found) {
      console.log('Super admin user already exists:', email);
    } else {
      const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
      await User.create({
        email,
        passwordHash,
        name: 'Super Admin',
        role: 'super_admin',
        organizationId: orgId,
      });
      console.log('Created super_admin:', email);
    }
  } else {
    console.log('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to create a super_admin user.');
  }
  await mongoose.disconnect();
  console.log('Seed done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
