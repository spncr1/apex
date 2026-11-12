import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import type { SessionSnapshot } from '../../types/database';

type SyncState = 'clean' | 'pending' | 'conflict';

interface SessionCacheRow {
  snapshot_json: string;
  server_revision: number;
  sync_state: SyncState;
}

interface PendingUploadRow {
  mutation_id: string;
  session_id: string;
  snapshot_json: string;
}

export interface PendingUpload {
  mutationId: string;
  sessionId: string;
  snapshot: SessionSnapshot;
  baseRevision: number;
}

export interface LocalSessionConflict {
  conflictId: string;
  sessionId: string;
  localSnapshot: SessionSnapshot;
  remoteSnapshot: SessionSnapshot;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let operation = Promise.resolve();

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('workout-tracker.db')
      .then(async (db) => {
        await db.execAsync(`
          create table if not exists read_cache (
            account_id text not null,
            cache_key text not null,
            payload_json text not null,
            updated_at text not null,
            primary key (account_id, cache_key)
          );
          create table if not exists session_cache (
            account_id text not null,
            session_id text not null,
            snapshot_json text not null,
            server_revision integer not null default 0,
            sync_state text not null default 'clean'
              check (sync_state in ('clean', 'pending', 'conflict')),
            updated_at text not null,
            primary key (account_id, session_id)
          );
          create table if not exists pending_uploads (
            sequence integer primary key autoincrement,
            mutation_id text not null unique,
            account_id text not null,
            session_id text not null,
            snapshot_json text not null,
            created_at text not null
          );
          create index if not exists pending_uploads_account_sequence_idx
            on pending_uploads (account_id, sequence);
          create table if not exists local_session_conflicts (
            conflict_id text primary key,
            account_id text not null,
            session_id text not null,
            local_snapshot_json text not null,
            remote_snapshot_json text not null,
            created_at text not null
          );
        `);
        return db;
      })
      .catch((error: unknown) => {
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = operation.then(task, task);
  operation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function validateOwner(accountId: string, snapshot: SessionSnapshot) {
  if (
    snapshot.session.user_id !== accountId ||
    snapshot.intervals.some((row) => row.user_id !== accountId) ||
    snapshot.exercises.some((row) => row.user_id !== accountId) ||
    snapshot.sets.some((row) => row.user_id !== accountId)
  ) {
    throw new Error('Session rows must belong to the active account.');
  }
}

export function saveCachedRead(
  accountId: string,
  key: string,
  payload: unknown,
) {
  return serial(async () => {
    const db = await database();
    await db.runAsync(
      `insert into read_cache (account_id, cache_key, payload_json, updated_at)
       values (?, ?, ?, ?)
       on conflict (account_id, cache_key) do update set
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      accountId,
      key,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
  });
}

export function getCachedRead<T>(
  accountId: string,
  key: string,
): Promise<T | null> {
  return serial(async () => {
    const db = await database();
    const row = await db.getFirstAsync<{ payload_json: string }>(
      'select payload_json from read_cache where account_id = ? and cache_key = ?',
      accountId,
      key,
    );
    return row ? (JSON.parse(row.payload_json) as T) : null;
  });
}

export function saveSessionEdit(accountId: string, snapshot: SessionSnapshot) {
  validateOwner(accountId, snapshot);
  return serial(async () => {
    const db = await database();
    const sessionId = snapshot.session.id;
    const mutationId = Crypto.randomUUID();
    const now = new Date().toISOString();
    const snapshotJson = JSON.stringify(snapshot);

    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<SessionCacheRow>(
        `select snapshot_json, server_revision, sync_state from session_cache
         where account_id = ? and session_id = ?`,
        accountId,
        sessionId,
      );
      if (current?.sync_state === 'conflict') {
        throw new Error('Resolve this session conflict before editing it.');
      }

      await db.runAsync(
        `insert into session_cache
           (account_id, session_id, snapshot_json, server_revision, sync_state, updated_at)
         values (?, ?, ?, ?, 'pending', ?)
         on conflict (account_id, session_id) do update set
           snapshot_json = excluded.snapshot_json,
           sync_state = 'pending',
           updated_at = excluded.updated_at`,
        accountId,
        sessionId,
        snapshotJson,
        current?.server_revision ?? 0,
        now,
      );
      await db.runAsync(
        `insert into pending_uploads
           (mutation_id, account_id, session_id, snapshot_json, created_at)
         values (?, ?, ?, ?, ?)`,
        mutationId,
        accountId,
        sessionId,
        snapshotJson,
        now,
      );
    });
    return mutationId;
  });
}

export function getCachedSession(accountId: string, sessionId: string) {
  return serial(async () => {
    const db = await database();
    const row = await db.getFirstAsync<SessionCacheRow>(
      `select snapshot_json, server_revision, sync_state from session_cache
       where account_id = ? and session_id = ?`,
      accountId,
      sessionId,
    );
    return row
      ? {
          snapshot: JSON.parse(row.snapshot_json) as SessionSnapshot,
          serverRevision: row.server_revision,
          syncState: row.sync_state,
        }
      : null;
  });
}

export function findCachedSessionByPlan(accountId: string, planId: string) {
  return serial(async () => {
    const db = await database();
    const rows = await db.getAllAsync<SessionCacheRow>(
      `select snapshot_json, server_revision, sync_state from session_cache
       where account_id = ? order by updated_at desc`,
      accountId,
    );
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json) as SessionSnapshot;
      if (snapshot.session.planned_workout_id === planId) {
        return {
          snapshot,
          serverRevision: row.server_revision,
          syncState: row.sync_state,
        };
      }
    }
    return null;
  });
}

export function getCachedSessionsForExercise(
  accountId: string,
  exerciseId: string,
) {
  return serial(async () => {
    const db = await database();
    const rows = await db.getAllAsync<SessionCacheRow>(
      `select snapshot_json, server_revision, sync_state from session_cache
       where account_id = ? order by updated_at desc`,
      accountId,
    );
    return rows.flatMap((row) => {
      const snapshot = JSON.parse(row.snapshot_json) as SessionSnapshot;
      return snapshot.exercises.some((item) => item.exercise_id === exerciseId)
        ? [
            {
              snapshot,
              serverRevision: row.server_revision,
              syncState: row.sync_state,
            },
          ]
        : [];
    });
  });
}

export function getCachedSessionsForAccount(accountId: string) {
  return serial(async () => {
    const db = await database();
    const rows = await db.getAllAsync<SessionCacheRow>(
      `select snapshot_json, server_revision, sync_state from session_cache
       where account_id = ? order by updated_at desc`,
      accountId,
    );
    return rows.map((row) => ({
      snapshot: JSON.parse(row.snapshot_json) as SessionSnapshot,
      serverRevision: row.server_revision,
      syncState: row.sync_state,
    }));
  });
}

export function cacheRemoteSession(
  accountId: string,
  snapshot: SessionSnapshot,
) {
  validateOwner(accountId, snapshot);
  return serial(async () => {
    const db = await database();
    await db.runAsync(
      `insert into session_cache
         (account_id, session_id, snapshot_json, server_revision, sync_state, updated_at)
       values (?, ?, ?, ?, 'clean', ?)
       on conflict (account_id, session_id) do update set
         snapshot_json = excluded.snapshot_json,
         server_revision = excluded.server_revision,
         updated_at = excluded.updated_at
       where session_cache.sync_state = 'clean'
         and session_cache.server_revision < excluded.server_revision`,
      accountId,
      snapshot.session.id,
      JSON.stringify(snapshot),
      snapshot.session.revision,
      new Date().toISOString(),
    );
  });
}

export function nextPendingUpload(
  accountId: string,
): Promise<PendingUpload | null> {
  return serial(async () => {
    const db = await database();
    const row = await db.getFirstAsync<
      PendingUploadRow & { server_revision: number }
    >(
      `select q.mutation_id, q.session_id, q.snapshot_json, c.server_revision
       from pending_uploads q
       join session_cache c
         on c.account_id = q.account_id and c.session_id = q.session_id
       where q.account_id = ? and c.sync_state = 'pending'
       order by q.sequence limit 1`,
      accountId,
    );
    return row
      ? {
          mutationId: row.mutation_id,
          sessionId: row.session_id,
          snapshot: JSON.parse(row.snapshot_json) as SessionSnapshot,
          baseRevision: row.server_revision,
        }
      : null;
  });
}

export function markUploadApplied(
  accountId: string,
  upload: PendingUpload,
  revision: number,
  serverSnapshot: SessionSnapshot,
) {
  validateOwner(accountId, serverSnapshot);
  return serial(async () => {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'delete from pending_uploads where mutation_id = ? and account_id = ?',
        upload.mutationId,
        accountId,
      );
      const remaining = await db.getFirstAsync<{ count: number }>(
        `select count(*) as count from pending_uploads
         where account_id = ? and session_id = ?`,
        accountId,
        upload.sessionId,
      );
      await db.runAsync(
        `update session_cache set
           server_revision = ?,
           snapshot_json = case when ? = 0 then ? else snapshot_json end,
           sync_state = case when ? = 0 then 'clean' else 'pending' end,
           updated_at = ?
         where account_id = ? and session_id = ?`,
        revision,
        remaining?.count ?? 0,
        JSON.stringify(serverSnapshot),
        remaining?.count ?? 0,
        new Date().toISOString(),
        accountId,
        upload.sessionId,
      );
    });
  });
}

export function markUploadConflict(
  accountId: string,
  upload: PendingUpload,
  conflictId: string,
  remoteSnapshot: SessionSnapshot,
) {
  validateOwner(accountId, remoteSnapshot);
  return serial(async () => {
    const db = await database();
    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<SessionCacheRow>(
        `select snapshot_json, server_revision, sync_state from session_cache
         where account_id = ? and session_id = ?`,
        accountId,
        upload.sessionId,
      );
      if (!current) throw new Error('Local session was not found.');
      await db.runAsync(
        `insert into local_session_conflicts
           (conflict_id, account_id, session_id, local_snapshot_json,
            remote_snapshot_json, created_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (conflict_id) do nothing`,
        conflictId,
        accountId,
        upload.sessionId,
        current.snapshot_json,
        JSON.stringify(remoteSnapshot),
        new Date().toISOString(),
      );
      await db.runAsync(
        `update session_cache set sync_state = 'conflict'
         where account_id = ? and session_id = ?`,
        accountId,
        upload.sessionId,
      );
    });
  });
}

export function getLocalSessionConflicts(accountId: string) {
  return serial(async () => {
    const db = await database();
    const rows = await db.getAllAsync<{
      conflict_id: string;
      session_id: string;
      local_snapshot_json: string;
      remote_snapshot_json: string;
    }>(
      `select conflict_id, session_id, local_snapshot_json, remote_snapshot_json
       from local_session_conflicts where account_id = ? order by created_at`,
      accountId,
    );
    return rows.map((row): LocalSessionConflict => ({
      conflictId: row.conflict_id,
      sessionId: row.session_id,
      localSnapshot: JSON.parse(row.local_snapshot_json) as SessionSnapshot,
      remoteSnapshot: JSON.parse(row.remote_snapshot_json) as SessionSnapshot,
    }));
  });
}

export function clearResolvedLocalConflict(
  accountId: string,
  conflictId: string,
  localSessionId: string,
  selected: SessionSnapshot,
) {
  validateOwner(accountId, selected);
  return serial(async () => {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'delete from pending_uploads where account_id = ? and session_id = ?',
        accountId,
        localSessionId,
      );
      await db.runAsync(
        'delete from local_session_conflicts where account_id = ? and conflict_id = ?',
        accountId,
        conflictId,
      );
      if (localSessionId !== selected.session.id) {
        await db.runAsync(
          'delete from session_cache where account_id = ? and session_id = ?',
          accountId,
          localSessionId,
        );
      }
      await db.runAsync(
        `insert into session_cache
           (account_id, session_id, snapshot_json, server_revision, sync_state, updated_at)
         values (?, ?, ?, ?, 'clean', ?)
         on conflict (account_id, session_id) do update set
           snapshot_json = excluded.snapshot_json,
           server_revision = excluded.server_revision,
           sync_state = 'clean',
           updated_at = excluded.updated_at`,
        accountId,
        selected.session.id,
        JSON.stringify(selected),
        selected.session.revision,
        new Date().toISOString(),
      );
    });
  });
}
