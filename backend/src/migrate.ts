import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
const client = await pool.connect();
try {
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(720184)');
 await client.query(await readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8').catch(()=>readFile('migrations/0001_initial.sql','utf8')));
 await client.query('COMMIT');
} catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();await pool.end();}
