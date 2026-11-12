import * as Crypto from 'expo-crypto';

import {
  cacheRemoteSession,
  clearResolvedLocalConflict,
  getCachedSession,
  getLocalSessionConflicts,
  type LocalSessionConflict,
} from '../features/sessions/sessionStore';
import type { SessionConflictRow, SessionSnapshot } from '../types/database';
import { supabase } from './supabase';

export interface ConflictReview {
  conflictId: string;
  localSessionId: string;
  localSnapshot: SessionSnapshot;
  remoteSnapshot: SessionSnapshot;
  rejectedSnapshot: SessionSnapshot | null;
  status: 'pending' | 'resolved';
  choice: 'local' | 'remote' | null;
  createdAt: string;
}

interface ResolutionResponse {
  kind: 'changed' | 'resolved';
  choice?: 'local' | 'remote';
  snapshot?: SessionSnapshot;
  revision?: number;
}

function localMatch(locals: LocalSessionConflict[], id: string) {
  return locals.find((item) => item.conflictId === id);
}

export async function loadConflictReviews(
  accountId: string,
  offline: boolean,
): Promise<ConflictReview[]> {
  const locals = await getLocalSessionConflicts(accountId);
  if (offline || !supabase)
    return locals.map((item) => ({
      conflictId: item.conflictId,
      localSessionId: item.sessionId,
      localSnapshot: item.localSnapshot,
      remoteSnapshot: item.remoteSnapshot,
      rejectedSnapshot: null,
      status: 'pending',
      choice: null,
      createdAt: item.localSnapshot.session.updated_at,
    }));

  const { data, error } = await supabase
    .from('session_conflicts')
    .select('*')
    .eq('user_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SessionConflictRow[];

  // A previous resolution may have reached the server just before the app closed.
  for (const row of rows) {
    const local = localMatch(locals, row.id);
    if (local && row.status === 'resolved') {
      const response = row.resolution_response;
      if (response?.snapshot) {
        await clearResolvedLocalConflict(
          accountId,
          row.id,
          local.sessionId,
          response.snapshot,
        );
      }
    }
  }

  return rows.map((row) => {
    const local = row.status === 'pending' ? localMatch(locals, row.id) : null;
    return {
      conflictId: row.id,
      localSessionId: local?.sessionId ?? row.local_snapshot.session.id,
      localSnapshot: local?.localSnapshot ?? row.local_snapshot,
      remoteSnapshot: row.remote_snapshot,
      rejectedSnapshot: row.rejected_snapshot,
      status: row.status,
      choice: row.resolution_response?.choice ?? null,
      createdAt: row.created_at,
    };
  });
}

export async function resolveConflict(
  accountId: string,
  review: ConflictReview,
  choice: 'local' | 'remote',
): Promise<'resolved' | 'changed'> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('resolve_session_conflict', {
    p_conflict_id: review.conflictId,
    p_choice: choice,
    p_local_snapshot: review.localSnapshot,
  });
  if (error) throw new Error(error.message);
  const response = data as ResolutionResponse;
  if (response.kind === 'changed') return 'changed';
  if (response.kind !== 'resolved' || !response.snapshot)
    throw new Error('Invalid resolution response.');
  const locals = await getLocalSessionConflicts(accountId);
  const local = localMatch(locals, review.conflictId);
  if (local)
    await clearResolvedLocalConflict(
      accountId,
      review.conflictId,
      local.sessionId,
      response.snapshot,
    );
  else await cacheRemoteSession(accountId, response.snapshot);
  return 'resolved';
}

export async function restoreConflictCopy(
  accountId: string,
  review: ConflictReview,
) {
  if (!supabase || !review.rejectedSnapshot || review.status !== 'resolved')
    throw new Error('Recoverable copy is unavailable.');
  const sessionId = review.remoteSnapshot.session.id;
  const cached = await getCachedSession(accountId, sessionId);
  if (cached && cached.syncState !== 'clean')
    throw new Error('Sync the current session before restoring a copy.');
  const { data: current, error: readError } = await supabase
    .from('workout_sessions')
    .select('revision')
    .eq('user_id', accountId)
    .eq('id', sessionId)
    .single();
  if (readError || !current)
    throw new Error(readError?.message ?? 'Session not found.');
  const { data, error } = await supabase.rpc('restore_session_copy', {
    p_conflict_id: review.conflictId,
    p_expected_revision: current.revision,
    p_mutation_id: Crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  const response = data as { kind: string; snapshot?: SessionSnapshot };
  if (response.kind !== 'applied' || !response.snapshot)
    throw new Error('Could not restore the session copy.');
  await cacheRemoteSession(accountId, response.snapshot);
}
