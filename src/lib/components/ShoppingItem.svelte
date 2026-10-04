<script lang="ts">
	import type { ListItem } from '$lib/types';

	interface Props {
		item: ListItem;
		sectionName: string | null;
		storeName: string | null;
		onComplete: () => void;
	}

	let { item, sectionName, storeName, onComplete }: Props = $props();

	function handleTap() {
		onComplete();
	}
</script>

<button
	onclick={handleTap}
	class="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 text-left transition-all active:scale-[0.98] {item.completed
		? 'bg-[var(--color-surface)] opacity-50'
		: 'bg-[var(--color-bg)]'}"
	style="min-height: 80px;"
	aria-label={item.completed ? 'Mark as not completed' : 'Mark as completed'}
>
	<div class="flex-1 min-w-0 py-3">
		<div
			class="truncate text-lg font-medium leading-tight {item.completed
				? 'text-[var(--color-text-secondary)] line-through'
				: 'text-[var(--color-text)]'}"
		>
			{item.name_snapshot}
		</div>
		<div class="flex flex-wrap gap-1.5 mt-1">
			{#if sectionName}
				<span
					class="inline-flex items-center rounded-md bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent)]"
				>
					{sectionName}
				</span>
			{/if}
			{#if storeName}
				<span
					class="inline-flex items-center rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]"
				>
					{storeName}
				</span>
			{/if}
			{#if item.quantity !== null}
				<span
					class="inline-flex items-center rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]"
				>
					{item.quantity}{item.unit ? ` ${item.unit}` : ''}
				</span>
			{/if}
		</div>
	</div>
</button>
