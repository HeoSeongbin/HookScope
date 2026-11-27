import {cleanupExpired} from './retention.js';
import {pool} from './db.js';
try{console.log(await cleanupExpired());}finally{await pool.end();}
