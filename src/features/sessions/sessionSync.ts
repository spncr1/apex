import { AppState, Platform } from 'react-native';

import { supabase } from '../../services/supabase';
import type { SessionSnapshot } from '../../types/database';
import {
  markUploadApplied,
  markUploadConflict,
  nextPendingUpload,
} from './sessionStore';

interface AppliedResponse {
  kind: 'applied';
  revision: number;
  snapshot: SessionSnapshot;
}

interface ConflictResponse {
  kind: 'conflict';
  conflict_id: string;
  remote_snapshot: SessionSnapshot;
}

type UploadResponse = AppliedResponse | ConflictResponse;

export interface SyncResult {
  uploaded: number;
  conflicts: number;
  error: string | null;
}

const syncingAccounts = new Set<string>();

function parseUploadResponse(value: unknown): UploadResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('The session upload returned an invalid response.');
  }
  const response = value as Record<string, unknown>;
  if (
    response.kind === 'applied' &&
    typeof response.revision === 'number' &&
    response.snapshot &&
    typeof response.snapshot === 'object'
  ) {
    return response as unknown as AppliedResponse;
  }
  if (
    response.kind === 'conflict' &&
    typeof response.conflict_id === 'string' &&
    response.remote_snapshot &&
    typeof response.remote_snapshot === 'object'
  ) {
    return response as unknown as ConflictResponse;
  }
  throw new Error('The session upload returned an invalid response.');
}

export async function syncPendingSessions(
  accountId: string,
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, conflicts: 0, error: null };
  if (!supabase) return { ...result, error: 'Supabase is not configured.' };
  if (syncingAccounts.has(accountId)) return result;

  syncingAccounts.add(accountId);
  try {
    let upload = await nextPendingUpload(accountId);
    if (!upload) return result;

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== accountId) {
      return { ...result, error: authError?.message ?? 'Account mismatch.' };
    }

    while (upload) {
      const { data, error } = await supabase.rpc('upload_session_snapshot', {
        p_mutation_id: upload.mutationId,
        p_base_revision: upload.baseRevision,
        p_snapshot: upload.snapshot,
      });
      if (error) return { ...result, error: error.message };

      const response = parseUploadResponse(data);
      if (response.kind === 'applied') {
        await markUploadApplied(
          accountId,
          upload,
          response.revision,
          response.snapshot,
        );
        result.uploaded += 1;
      } else {
        await markUploadConflict(
          accountId,
          upload,
          response.conflict_id,
          response.remote_snapshot,
        );
        result.conflicts += 1;
      }
      upload = await nextPendingUpload(accountId);
    }
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : 'Session sync failed.',
    };
  } finally {
    syncingAccounts.delete(accountId);
  }
}

export function startSessionSync(accountId: string) {
  const retry = () => {
    void syncPendingSessions(accountId);
  };

  retry();
  const interval = setInterval(retry, 30_000);
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') retry();
  });
  if (Platform.OS === 'web') window.addEventListener('online', retry);

  return () => {
    clearInterval(interval);
    appStateSubscription.remove();
    if (Platform.OS === 'web') window.removeEventListener('online', retry);
  };
}
