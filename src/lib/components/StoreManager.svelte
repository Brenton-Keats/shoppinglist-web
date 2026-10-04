<script lang="ts">
	import { Plus, ArrowUp, ArrowDown, Pencil, Trash2, Check, X } from '@lucide/svelte';
	import type { Store } from '$lib/types';
	import {
		createStore,
		updateStore,
		softDeleteStore,
		getActiveEntities
	} from '$lib/db/operations';
	import { syncStateStore } from '$lib/sync/state.svelte';
	import { reorderStores } from '$lib/drag-drop/ordering';
	import { findDropTarget } from '$lib/drag-drop/detection';
	import type { DragStartEvent } from '$lib/drag-drop/detection';
	import DragHandle from '$lib/components/DragHandle.svelte';

	let stores = $state<Store[]>([]);
	let loading = $state(true);
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let adding = $state(false);
	let newName = $state('');
	let confirmDeleteId = $state<string | null>(null);
	let newInputRef = $state<HTMLInputElement | null>(null);
	let editInputRef = $state<HTMLInputElement | null>(null);

	async function load() {
		stores = (await getActiveEntities<Store>('stores')).sort((a, b) => a.sort_order - b.sort_order);
		loading = false;
	}

	// Re-run when dataVersion changes (new remote data arrived)
	$effect(() => {
		syncStateStore.dataVersion;
		load();
	});

	$effect(() => {
		if (adding && newInputRef) {
			newInputRef.focus();
		}
	});

	$effect(() => {
		if (editingId && editInputRef) {
			editInputRef.focus();
		}
	});

	async function handleAdd() {
		const name = newName.trim();
		if (!name) return;

		const maxOrder = stores.length > 0 ? Math.max(...stores.map((s) => s.sort_order)) : 0;
		await createStore({
			name,
			sort_order: maxOrder + 1,
			active: true
		});
		newName = '';
		adding = false;
		await load();
	}

	function startEdit(store: Store) {
		editingId = store.id;
		editName = store.name;
	}

	function cancelEdit() {
		editingId = null;
		editName = '';
	}

	async function handleEditSave() {
		const name = editName.trim();
		if (!name || !editingId) return;
		await updateStore(editingId, { name });
		editingId = null;
		editName = '';
		await load();
	}

	async function toggleActive(store: Store) {
		await updateStore(store.id, { active: !store.active });
		await load();
	}

	function requestDelete(id: string) {
		confirmDeleteId = id;
	}

	function cancelDelete() {
		confirmDeleteId = null;
	}

	async function confirmDelete(id: string) {
		await softDeleteStore(id);
		confirmDeleteId = null;
		await load();
	}

	async function moveUp(index: number) {
		if (index <= 0) return;
		const current = stores[index];
		const prev = stores[index - 1];
		const temp = current.sort_order;
		await updateStore(current.id, { sort_order: prev.sort_order });
		await updateStore(prev.id, { sort_order: temp });
		await load();
	}

	async function moveDown(index: number) {
		if (index >= stores.length - 1) return;
		const current = stores[index];
		const next = stores[index + 1];
		const temp = current.sort_order;
		await updateStore(current.id, { sort_order: next.sort_order });
		await updateStore(next.id, { sort_order: temp });
		await load();
	}

	function handleDragStart(_e: DragStartEvent) {
		// Drag start handled by DragHandle
	}

	function handleDragMove(_x: number, _y: number) {
		// Transform handled by row element
	}

	async function handleDragEnd(storeId: string, x: number, y: number) {
		const target = findDropTarget(x, y);
		if (!target || target.type !== 'store' || target.id === storeId) {
			return;
		}

		const targetIndex = stores.findIndex((s) => s.id === target.id);
		if (targetIndex === -1) return;

		await reorderStores(storeId, targetIndex);
		await load();
	}

	function handleKeydown(e: KeyboardEvent, action: 'add' | 'edit') {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (action === 'add') handleAdd();
			else handleEditSave();
		} else if (e.key === 'Escape') {
			if (action === 'add') {
				adding = false;
				newName = '';
			} else {
				cancelEdit();
			}
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-base font-semibold text-[var(--color-text)]">Stores</h3>
		{#if !adding}
			<button
				onclick={() => (adding = true)}
				class="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white active:bg-[var(--color-primary-dark)]"
			>
				<Plus size={16} />
				Add
			</button>
		{/if}
	</div>

	{#if adding}
		<div class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
			<input
				bind:this={newInputRef}
				bind:value={newName}
				onkeydown={(e) => handleKeydown(e, 'add')}
				placeholder="Store name"
				class="flex-1 rounded-md bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-border)] focus:ring-[var(--color-accent)]"
			/>
			<button
				onclick={handleAdd}
				class="rounded-md p-2 text-[var(--color-success)] active:bg-[var(--color-surface)]"
				aria-label="Save"
			>
				<Check size={18} />
			</button>
			<button
				onclick={() => { adding = false; newName = ''; }}
				class="rounded-md p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
				aria-label="Cancel"
			>
				<X size={18} />
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="py-4 text-center text-sm text-[var(--color-text-secondary)]">Loading...</div>
	{:else if stores.length === 0}
		<div class="rounded-lg border border-dashed border-[var(--color-border)] py-6 text-center">
			<p class="text-sm text-[var(--color-text-secondary)]">No stores yet</p>
		</div>
	{:else}
		<div class="flex flex-col gap-1">
			{#each stores as store, index (store.id)}
				<div
					class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
					data-store-id={store.id}
				>
					<DragHandle
						data={{ type: 'store', id: store.id }}
						onDragStart={handleDragStart}
						onDragMove={handleDragMove}
						onDragEnd={(x, y) => handleDragEnd(store.id, x, y)}
					/>

					{#if editingId === store.id}
						<input
							bind:this={editInputRef}
							bind:value={editName}
							onkeydown={(e) => handleKeydown(e, 'edit')}
							class="flex-1 rounded-md bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-border)] focus:ring-[var(--color-accent)]"
						/>
						<button
							onclick={handleEditSave}
							class="rounded-md p-1.5 text-[var(--color-success)] active:bg-[var(--color-surface)]"
							aria-label="Save"
						>
							<Check size={16} />
						</button>
						<button
							onclick={cancelEdit}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
							aria-label="Cancel"
						>
							<X size={16} />
						</button>
					{:else}
						<span class="flex-1 text-sm text-[var(--color-text)]">{store.name}</span>

						<button
							onclick={() => moveUp(index)}
							disabled={index === 0}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)] disabled:opacity-30"
							aria-label="Move up"
						>
							<ArrowUp size={14} />
						</button>
						<button
							onclick={() => moveDown(index)}
							disabled={index === stores.length - 1}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)] disabled:opacity-30"
							aria-label="Move down"
						>
							<ArrowDown size={14} />
						</button>

						<button
							onclick={() => toggleActive(store)}
							role="switch"
							aria-checked={store.active}
							class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors {store.active ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}"
							style="min-height: 1.75rem; min-width: 3rem;"
							aria-label={store.active ? 'Deactivate' : 'Activate'}
						>
							<span
								class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform {store.active ? 'translate-x-6' : 'translate-x-1'}"
							></span>
						</button>

						<button
							onclick={() => startEdit(store)}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
							aria-label="Edit"
						>
							<Pencil size={14} />
						</button>

						{#if confirmDeleteId === store.id}
							<div class="flex items-center gap-1">
								<span class="text-xs text-[var(--color-error)]">Delete?</span>
								<button
									onclick={() => confirmDelete(store.id)}
									class="rounded-md p-1.5 text-[var(--color-error)] active:bg-[var(--color-surface)]"
									aria-label="Confirm delete"
								>
									<Check size={14} />
								</button>
								<button
									onclick={cancelDelete}
									class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
									aria-label="Cancel"
								>
									<X size={14} />
								</button>
							</div>
						{:else}
							<button
								onclick={() => requestDelete(store.id)}
								class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
								aria-label="Delete"
							>
								<Trash2 size={14} />
							</button>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
