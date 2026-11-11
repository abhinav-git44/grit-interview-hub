import { DomainError, fail } from './core';
import type { DB } from './types';

/**
 * A tiny transactional store.
 *  - Every write runs on a deep copy ("draft"); if the function throws, nothing is committed (atomicity).
 *  - Commit is optimistic: it fails with CONFLICT if another commit landed since the draft was taken.
 *    `run()` retries on CONFLICT, re-executing the business checks against fresh data — the same
 *    guarantee a Postgres `SELECT … FOR UPDATE` + unique index gives in the production schema.
 */
export type Listener = (db: DB) => void;

export class Store {
  private db: DB;
  private listeners = new Set<Listener>();
  constructor(initial: DB, private persist?: (db: DB) => void) { this.db = initial; }

  get snapshot(): DB { return this.db; }

  begin() {
    const baseVersion = this.db.version;
    const draft: DB = structuredClone(this.db);
    return {
      draft,
      commit: () => {
        if (this.db.version !== baseVersion) fail('CONFLICT', 'Data changed while you were working. Please retry.');
        draft.version = baseVersion + 1;
        this.db = draft;
        try { this.persist?.(draft); } catch { /* storage unavailable: keep in memory */ }
        this.listeners.forEach(l => l(draft));
      },
    };
  }

  run<R>(fn: (draft: DB) => R, retries = 2): R {
    for (let attempt = 0; ; attempt++) {
      const tx = this.begin();
      const result = fn(tx.draft); // throws → nothing committed
      try { tx.commit(); return result; }
      catch (e) { if (e instanceof DomainError && e.code === 'CONFLICT' && attempt < retries) continue; throw e; }
    }
  }

  replace(db: DB) { this.db = db; try { this.persist?.(db); } catch { /* ignore */ } this.listeners.forEach(l => l(db)); }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
}
