<script lang="ts">
	import type { ListItem } from '$lib/types';
	import QuantityControl from './QuantityControl.svelte';
	import { effectiveQuantity } from '$lib/utils/quantity';

	interface Props {
		item: ListItem;
		sectionName: string | null;
		storeName: string | null;
		onComplete: () => void;
		/** Optional in read-only mode (shop mode passes no adjuster). */
		onAdjustQuantity?: (delta: number) => void;
		/**
		 * Shop mode (Item 9): render the quantity as plain read-only TEXT with no
		 * editable touch surface. The list-management view leaves this false and
		 * keeps the editable QuantityControl.
		 */
		readOnly?: boolean;
	}

	let {
		item,
		sectionName,
		storeName,
		onComplete,
		onAdjustQuantity,
		readOnly = false
	}: Props = $props();

	function handleTap() {
		onComplete();
	}
</script>

<div
	class="flex w-full items-stretch rounded-xl border border-[var(--color-border)] text-left transition-all {item.completed
		? 'bg-[var(--color-surface)] opacity-50'
		: 'bg-[var(--color-bg)]'}"
	style="min-height: 80px;"
>
	<!-- Primary tap target: toggle completed. Its own button so the quantity
	     control (a sibling) never hijacks the complete gesture. -->
	<button
		onclick={handleTap}
		class="flex flex-1 min-w-0 items-center gap-3 px-4 text-left active:scale-[0.98]"
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
			</div>
		</div>
	</button>

	<!-- Quantity: editable control on the list view, read-only text in shop mode. -->
	<div class="flex items-center pr-3">
		{#if readOnly}
			<span
				data-testid="shop-quantity-text"
				data-quantity={effectiveQuantity(item.quantity)}
				class="px-3 text-base font-semibold {effectiveQuantity(item.quantity) <= 1
					? 'text-[var(--color-text-secondary)]/50'
					: 'text-[var(--color-text)]'}"
			>
				×{effectiveQuantity(item.quantity)}
			</span>
		{:else}
			<QuantityControl
				quantity={item.quantity}
				onAdjust={(delta) => onAdjustQuantity?.(delta)}
				label={item.name_snapshot}
			/>
		{/if}
	</div>
</div>
