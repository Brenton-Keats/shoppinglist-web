<script lang="ts">
	import { Plus, ArrowUp, ArrowDown, Pencil, Trash2, Check, X } from '@lucide/svelte';
	import type { Section } from '$lib/types';
	import {
		createSection,
		updateSection,
		softDeleteSection,
		getActiveEntities
	} from '$lib/db/operations';
	import { syncStateStore } from '$lib/sync/state.svelte';
	import { reorderSections } from '$lib/drag-drop/ordering';
	import { compareSortKeys, sortKeyAfter, sortKeyBetween } from '$lib/utils/ordering';
	import { findDropTarget } from '$lib/drag-drop/detection';
	import type { DragStartEvent } from '$lib/drag-drop/detection';
	import DragHandle from '$lib/components/DragHandle.svelte';

	let sections = $state<Section[]>([]);
	let loading = $state(true);
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let adding = $state(false);
	let newName = $state('');
	let confirmDeleteId = $state<string | null>(null);
	let newInputRef = $state<HTMLInputElement | null>(null);
	let editInputRef = $state<HTMLInputElement | null>(null);

	async function load() {
		const all = await getActiveEntities<Section>('sections');
		sections = all.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
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

		const lastKey = sections.length > 0 ? sections[sections.length - 1].sort_order : null;
		await createSection({
			list_id: null,
			name,
			sort_order: sortKeyAfter(lastKey),
			active: true
		});
		newName = '';
		adding = false;
		await load();
	}

	function startEdit(section: Section) {
		editingId = section.id;
		editName = section.name;
	}

	function cancelEdit() {
		editingId = null;
		editName = '';
	}

	async function handleEditSave() {
		const name = editName.trim();
		if (!name || !editingId) return;
		await updateSection(editingId, { name });
		editingId = null;
		editName = '';
		await load();
	}

	async function toggleActive(section: Section) {
		await updateSection(section.id, { active: !section.active });
		await load();
	}

	function requestDelete(id: string) {
		confirmDeleteId = id;
	}

	function cancelDelete() {
		confirmDeleteId = null;
	}

	async function confirmDelete(id: string) {
		await softDeleteSection(id);
		confirmDeleteId = null;
		await load();
	}

	async function moveUp(index: number) {
		if (index <= 0) return;
		// Insert a key between the item two-above (if any) and the item above.
		const keyAboveAbove = index >= 2 ? sections[index - 2].sort_order : null;
		const keyAbove = sections[index - 1].sort_order;
		const newKey = sortKeyBetween(keyAboveAbove, keyAbove);
		await updateSection(sections[index].id, { sort_order: newKey });
		await load();
	}

	async function moveDown(index: number) {
		if (index >= sections.length - 1) return;
		// Insert a key between the item below and the item two-below (if any).
		const keyBelow = sections[index + 1].sort_order;
		const keyBelowBelow = index + 2 < sections.length ? sections[index + 2].sort_order : null;
		const newKey = sortKeyBetween(keyBelow, keyBelowBelow);
		await updateSection(sections[index].id, { sort_order: newKey });
		await load();
	}

	function handleDragStart(_e: DragStartEvent) {
		// Drag start handled by DragHandle
	}

	function handleDragMove(_x: number, _y: number) {
		// Transform handled by row element
	}

	async function handleDragEnd(sectionId: string, x: number, y: number) {
		const target = findDropTarget(x, y);
		if (!target || target.type !== 'section' || target.id === sectionId) {
			return;
		}

		const targetIndex = sections.findIndex((s) => s.id === target.id);
		if (targetIndex === -1) return;

		await reorderSections(sectionId, targetIndex, null);
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
		<h3 class="text-base font-semibold text-[var(--color-text)]">Sections</h3>
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
				placeholder="Section name"
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
	{:else if sections.length === 0}
		<div class="rounded-lg border border-dashed border-[var(--color-border)] py-6 text-center">
			<p class="text-sm text-[var(--color-text-secondary)]">No sections yet</p>
		</div>
	{:else}
		<div class="flex flex-col gap-1">
			{#each sections as section, index (section.id)}
				<div
					class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
					data-section-id={section.id}
				>
					<DragHandle
						data={{ type: 'section', id: section.id }}
						onDragStart={handleDragStart}
						onDragMove={handleDragMove}
						onDragEnd={(x, y) => handleDragEnd(section.id, x, y)}
					/>

					{#if editingId === section.id}
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
						<span class="flex-1 text-sm text-[var(--color-text)]">{section.name}</span>

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
							disabled={index === sections.length - 1}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)] disabled:opacity-30"
							aria-label="Move down"
						>
							<ArrowDown size={14} />
						</button>

						<button
							onclick={() => toggleActive(section)}
							role="switch"
							aria-checked={section.active}
							class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors {section.active ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}"
							style="min-height: 1.75rem; min-width: 3rem;"
							aria-label={section.active ? 'Deactivate' : 'Activate'}
						>
							<span
								class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform {section.active ? 'translate-x-6' : 'translate-x-1'}"
							></span>
						</button>

						<button
							onclick={() => startEdit(section)}
							class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
							aria-label="Edit"
						>
							<Pencil size={14} />
						</button>

						{#if confirmDeleteId === section.id}
							<div class="flex items-center gap-1">
								<span class="text-xs text-[var(--color-error)]">Delete?</span>
								<button
									onclick={() => confirmDelete(section.id)}
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
								onclick={() => requestDelete(section.id)}
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
