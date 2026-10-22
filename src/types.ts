export type Mode = 'local' | 'liara';
export type RunStatus = 'collecting' | 'patching' | 'testing' | 'awaiting_approval' | 'deploying' | 'verifying' | 'resolved' | 'failed' | 'rejected';
export interface Project { id: string; name: string; mode: Mode; currentSnapshot: string; revision: number; remoteRelease?: string; }
export interface Evidence { id: string; kind: string; title: string; observedAt: string; available: boolean; data: unknown; limitation?: string; }
export interface Check { name: string; passed: boolean; expected: unknown; actual: unknown; }
export interface Verification { passed: boolean; checks: Check[]; durationMs: number; source: 'isolated-contract-tests' | 'http'; matched?: boolean; }
export interface RunEvent { id: number; runId: string; at: string; status: string; message: string; }
export interface Incident { id: string; projectId: string; request: string; status: RunStatus; createdAt: string; updatedAt: string; evidence: Evidence[]; diagnosis?: string; change?: string; diff?: string; baseline?: Verification; candidate?: Verification; verification?: Verification; actionId?: string; error?: string; threadId?: string; releaseId?: string; recoveryOf?: string; }
export interface ActionPlan { id: string; runId?: string; projectId: string; kind: 'deploy' | 'restart' | 'rollback' | 'env'; status: 'pending' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'expired'; createdAt: string; expiresAt: string; baseRevision: number; baseSnapshot: string; baseRelease?: string; snapshotId: string; digest: string; title: string; summary: string; risk: string; cost: string; approvedAt?: string; executedAt?: string; error?: string; result?: unknown; envChanges?: Record<string,string>; }
export interface Snapshot { id: string; digest: string; files: Record<string,string>; createdAt: string; }
