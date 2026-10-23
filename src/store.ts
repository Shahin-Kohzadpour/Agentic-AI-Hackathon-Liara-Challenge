import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent } from './types.ts';

export class Store {
  db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'state.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (project_id TEXT PRIMARY KEY, owner TEXT NOT NULL);`);
  }
  get<T>(collection: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM documents WHERE collection=? AND id=?').get(collection,id) as {value:string}|undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  list<T>(collection: string): T[] {
    return (this.db.prepare('SELECT value FROM documents WHERE collection=? ORDER BY rowid DESC').all(collection) as {value:string}[]).map(r=>JSON.parse(r.value) as T);
  }
  put<T extends {id:string}>(collection:string, value:T) {
    this.db.prepare('INSERT INTO documents(collection,id,value) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value').run(collection,value.id,JSON.stringify(value));
  }
  transaction<T>(fn:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  lock(projectId:string,owner:string) {
    try { this.db.prepare('INSERT INTO locks VALUES(?,?)').run(projectId,owner); }
    catch { throw new Error('یک عملیات دیگر برای این پروژه در حال اجراست.'); }
  }
  unlock(projectId:string,owner:string) { this.db.prepare('DELETE FROM locks WHERE project_id=? AND owner=?').run(projectId,owner); }
  event(runId:string,status:string,message:string) {
    this.db.prepare('INSERT INTO events(run_id,at,status,message) VALUES(?,?,?,?)').run(runId,new Date().toISOString(),status,message);
  }
  events(after=0):RunEvent[] {
    return (this.db.prepare('SELECT id,run_id as runId,at,status,message FROM events WHERE id>? ORDER BY id LIMIT 250').all(after) as unknown) as RunEvent[];
  }
  recentEvents():RunEvent[] {
    return (this.db.prepare('SELECT id,run_id as runId,at,status,message FROM events ORDER BY id DESC LIMIT 250').all() as unknown as RunEvent[]).reverse();
  }
  eventsForRun(runId:string):RunEvent[] {
    return this.db.prepare('SELECT id,run_id as runId,at,status,message FROM events WHERE run_id=? ORDER BY id').all(runId) as unknown as RunEvent[];
  }
}
