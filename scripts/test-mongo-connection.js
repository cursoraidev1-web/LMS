/**
 * Test MongoDB connection using MONGODB_URI from .env
 * Run from backend folder: node scripts/test-mongo-connection.js
 */
require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

// Use Google DNS for SRV lookup when mongodb+srv fails with querySrv ECONNREFUSED
if (uri.startsWith('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const safeUri = uri.replace(/:([^@]+)@/, ':****@');
console.log('Connecting to MongoDB...', safeUri);

mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log('MongoDB connected successfully. State:', mongoose.connection.readyState);
    return mongoose.disconnect();
  })
  .then(() => {
    console.log('Disconnected. Connection test passed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    if (err.message && err.message.includes('querySrv')) {
      console.error('\nquerySrv error = DNS SRV lookup failed. Try:');
      console.error('  • Use a DNS that supports SRV (e.g. 8.8.8.8 or 1.1.1.1)');
      console.error('  • Or in Atlas use "Connect using MongoDB Compass" and copy the standard (non-SRV) URI into MONGODB_URI');
      console.error('  • See backend/MONGODB-ATLAS-CHECKLIST.md for step-by-step.');
    } else {
      console.error('\nCommon fixes:');
      console.error('1. Atlas: Network Access -> Add your current IP (or 0.0.0.0/0 for testing)');
      console.error('2. Atlas: Database Access -> user has read/write on the database');
      console.error('3. Check MONGODB_URI in .env: correct password, cluster host, and database name');
      console.error('4. If using VPN/firewall, ensure it allows outbound to *.mongodb.net');
    }
    process.exit(1);
  });
