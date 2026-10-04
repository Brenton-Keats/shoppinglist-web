<script lang="ts">
	import { Trash2, MoreVertical } from '@lucide/svelte';
	import type { ListItem } from '$lib/types';
	import DragHandle from './DragHandle.svelte';
	import MoveButtons from './MoveButtons.svelte';
	import { setDropTargetData } from '$lib/drag-drop/detection';
	import type { DragData, DragStartEvent } from '$lib/drag-drop/detection';

	interface Props {
		item: ListItem;
		sectionName: string | null;
		storeName: string | null;
		onToggle: () => void;
		onDelete: () => void;
		dragData?: DragData;
		dropTargetData?: DragData;
		onDragStart?: (e: DragStartEvent) => void;
		onDragMove?: (x: number, y: number) => void;
		onDragEnd?: (x: number, y: number, target?: DragData) => void;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		canMoveSection?: boolean;
		canMoveStore?: boolean;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
		onMoveSection?: () => void;
		onMoveStore?: () => void;
		showMoveButtons?: boolean;
		onToggleMoveButtons?: () => void;
	}

	let {
		item,
		sectionName,
		storeName,
		onToggle,
		onDelete,
		dragData,
		dropTargetData,
		onDragStart,
		onDragMove,
		onDragEnd,
		canMoveUp = false,
		canMoveDown = false,
		canMoveSection = false,
		canMoveStore = false,
		onMoveUp,
		onMoveDown,
		onMoveSection,
		onMoveStore,
		showMoveButtons = false,
		onToggleMoveButtons
	}: Props = $props();

	$effect(() => {
		if (rowElement && dropTargetData) {
			setDropTargetData(rowElement, dropTargetData);
		}
	});

	let isDeleting = $state(false);
	let deleteTimer: ReturnType<typeof setTimeout> | null = null;
	let rowElement = $state<HTMLElement | null>(null);
	let dragStartX = $state(0);
	let dragStartY = $state(0);

	function handleDelete() {
		if (isDeleting) {
			if (deleteTimer) clearTimeout(deleteTimer);
			onDelete();
		} else {
			isDeleting = true;
			deleteTimer = setTimeout(() => {
				isDeleting = false;
			}, 3000);
		}
	}

	function handleDragStart(e: DragStartEvent) {
		dragStartX = e.x;
		dragStartY = e.y;
		if (rowElement) {
			rowElement.classList.add('dragging');
			rowElement.style.transform = 'scale(1.02)';
		}
		onDragStart?.(e);
	}

	function handleDragMove(x: number, y: number) {
		if (rowElement) {
			const dx = x - dragStartX;
			const dy = y - dragStartY;
			rowElement.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
		}
		onDragMove?.(x, y);
	}

	function handleDragEnd(x: number, y: number, target?: DragData) {
		if (rowElement) {
			rowElement.classList.remove('dragging');
			rowElement.style.transform = '';
		}
		onDragEnd?.(x, y, target);
	}
</script>

<div
	bind:this={rowElement}
	class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 transition-opacity {item.completed ? 'opacity-50' : ''}"
	role="listitem"
	data-item-id={item.id}
>
	{#if dragData && onDragStart && onDragMove && onDragEnd}
		<DragHandle
			data={dragData}
			onDragStart={handleDragStart}
			onDragMove={handleDragMove}
			onDragEnd={handleDragEnd}
		/>
	{/if}

	<button
		onclick={onToggle}
		class="flex shrink-0 items-center justify-center rounded-lg"
		aria-label={item.completed ? 'Mark as not completed' : 'Mark as completed'}
		aria-checked={item.completed}
		role="checkbox"
	>
		<div
			class="flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors {item.completed
				? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
				: 'border-[var(--color-border)] bg-transparent'}"
		>
			{#if item.completed}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="20 6 9 17 4 12" />
				</svg>
			{/if}
		</div>
	</button>

	<div class="flex-1 min-w-0">
		<div class="truncate text-sm font-medium text-[var(--color-text)] {item.completed ? 'line-through' : ''}">
			{item.name_snapshot}
		</div>
		<div class="flex flex-wrap gap-1.5 mt-0.5">
			{#if sectionName}
				<span class="inline-flex items-center rounded-md bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
					{sectionName}
				</span>
			{/if}
			{#if storeName}
				<span class="inline-flex items-center rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
					{storeName}
				</span>
			{/if}
			{#if item.quantity !== null}
				<span class="inline-flex items-center rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
					{item.quantity}{item.unit ? ` ${item.unit}` : ''}
				</span>
			{/if}
		</div>
	</div>

	{#if showMoveButtons}
		<MoveButtons
			{canMoveUp}
			{canMoveDown}
			{canMoveSection}
			{canMoveStore}
			{onMoveUp}
			{onMoveDown}
			{onMoveSection}
			{onMoveStore}
		/>
	{/if}

	{#if onToggleMoveButtons}
		<button
			onclick={onToggleMoveButtons}
			class="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
			aria-label="More options"
		>
			<MoreVertical size={18} />
		</button>
	{/if}

	<button
		onclick={handleDelete}
		class="flex shrink-0 items-center justify-center rounded-lg p-1.5 {isDeleting ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'} active:bg-[var(--color-surface)]"
		aria-label={isDeleting ? 'Confirm delete' : 'Delete item'}
	>
		<Trash2 size={18} />
	</button>
</div>

<style>
	:global(.dragging) {
		transform: scale(1.02);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		opacity: 0.9;
		z-index: 50;
		position: relative;
	}
</style>
