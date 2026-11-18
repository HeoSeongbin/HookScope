import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:10, connectionTimeoutMillis:5000});
export const db = drizzle(pool);
