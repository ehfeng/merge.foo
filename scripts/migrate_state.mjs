// Operator command. Uses the configured external Neon PostgreSQL database; never prints its URL.
import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
const connection=process.env.DATABASE_URL;
if(!connection)throw new Error('Provide DATABASE_URL through the operator environment.');
const sql=neon(connection);
const source=await readFile(new URL('../migrations/001_shared_state.sql',import.meta.url),'utf8');
const statements=source.split(';').map(s=>s.trim()).filter(Boolean);
try {await sql.transaction(statements.map(text=>sql.query(text)));console.log('Shared PostgreSQL schema migration completed.');}
catch {throw new Error('Schema migration failed. Check database configuration; credentials are never printed.');}
