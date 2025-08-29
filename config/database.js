const { Pool } = require("pg");
require("dotenv").config();

// Konfigurasi connection string untuk Railway
const connectionString = process.env.DATABASE_URL;

const poolConfig = connectionString
  ? {
      connectionString: connectionString,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false, // Sering diperlukan di hosting seperti Railway
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    }
  : {
      // Konfigurasi untuk development lokal (fallback)
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 5432,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

const pool = new Pool(poolConfig);

module.exports = pool;
