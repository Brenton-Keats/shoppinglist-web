import { getPendingChanges } from '$lib/db/queries';

export type SyncState =
	| { status: 'idle' }
	| { status: 'syncing' }
	| { status: 'pending'; count: number }
	| { status: 'offline' }
	| { status: 'unauthenticated' }
	| { status: 'error'; message: string };

class SyncStateStore {
	state = $state<SyncState>({ status: 'idle' });
	pendingCount = $state(0);
	lastSyncTime = $state<Date | null>(null);
	serverRevision = $state<number | null>(null);
	/** Increments each time new remote data is applied locally */
	dataVersion = $state(0);

	constructor() {
		if (typeof window !== 'undefined') {
			this.refreshPendingCount();
		}
	}

	getSyncState(): SyncState {
		return this.state;
	}

	setSyncState(state: SyncState): void {
		this.state = state;
		if (state.status === 'pending') {
			this.pendingCount = state.count;
		}
	}

	async getPendingChangeCount(): Promise<number> {
		const changes = await getPendingChanges();
		return changes.length;
	}

	async refreshPendingCount(): Promise<void> {
		const count = await this.getPendingChangeCount();
		this.pendingCount = count;
		if (count > 0 && this.state.status === 'idle') {
			this.state = { status: 'pending', count };
		} else if (count === 0 && this.state.status === 'pending') {
			this.state = { status: 'idle' };
		}
	}

	setSyncing(): void {
		this.state = { status: 'syncing' };
	}

	setIdle(): void {
		this.state = { status: 'idle' };
	}

	setOffline(): void {
		this.state = { status: 'offline' };
	}

	setUnauthenticated(): void {
		this.state = { status: 'unauthenticated' };
	}

	setError(message: string): void {
		this.state = { status: 'error', message };
	}

	setLastSyncTime(time: Date): void {
		this.lastSyncTime = time;
	}

	setServerRevision(revision: number | null): void {
		this.serverRevision = revision;
	}
}

export const syncStateStore = new SyncStateStore();

export function getSyncState(): SyncState {
	return syncStateStore.getSyncState();
}

export function setSyncState(state: SyncState): void {
	syncStateStore.setSyncState(state);
}

export function getPendingChangeCount(): Promise<number> {
	return syncStateStore.getPendingChangeCount();
}
