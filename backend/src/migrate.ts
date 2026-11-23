import { readFile,readdir } from 'node:fs/promises';
import { pool } from './db.js';
const client = await pool.connect();
try {
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(720184)');
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
 const directory=new URL('../migrations/',import.meta.url);
 const migrations=(await readdir(directory)).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
 for(const name of migrations){
  const applied=await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
  if(applied.rowCount)continue;
  await client.query(await readFile(new URL(name,directory),'utf8'));
  await client.query('INSERT INTO schema_migrations(name) VALUES ($1)',[name]);
 }
 await client.query('COMMIT');
} catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();await pool.end();}
