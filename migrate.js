require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
  console.error('DATABASE_URL não definido.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
  query_timeout: 30000
});

(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const seedPath = path.join(__dirname, 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seed = fs.readFileSync(seedPath, 'utf8').trim();
      if (seed) await pool.query(seed);
    }
    console.log('OK: estrutura e catálogo aplicados. Contas existentes foram preservadas.');
  } catch (e) {
    console.error('Falha:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
