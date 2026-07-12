import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: './.env' });

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set in .env");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log("Checking and adding billing column to calls table...");
    await client.query(`
      ALTER TABLE public.calls
      ADD COLUMN IF NOT EXISTS billing JSONB DEFAULT '{}'::jsonb;
    `);
    console.log("✅ Column 'billing' check/addition complete.");
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
