<script lang="ts">
	import { Minus, Plus } from '@lucide/svelte';
	import { effectiveQuantity, MIN_QUANTITY } from '$lib/utils/quantity';

	interface Props {
		/** Raw stored quantity (null reads as 1). */
		quantity: number | null;
		/** Called with +1 / -1 when the user taps the control. Writes are immediate. */
		onAdjust: (delta: number) => void;
		/** Accessible label for the item this controls (e.g. the item name). */
		label?: string;
	}

	let { quantity, onAdjust, label }: Props = $props();

	const value = $derived(effectiveQuantity(quantity));
	// Mute-at-1: a faint, de-emphasised `×1` is shown at quantity 1 (rather than
	// fully hidden) so the badge stays the one reachable entry point to the
	// control — hiding it entirely would leave no way to increment from 1. From
	// 2 upward the badge is rendered at full emphasis.
	const muted = $derived(value <= MIN_QUANTITY);
	const atFloor = $derived(value <= MIN_QUANTITY);

	let open = $state(false);

	function toggle() {
		open = !open;
	}

	function close() {
		open = false;
	}

	function increment() {
		onAdjust(1);
	}

	function decrement() {
		if (atFloor) return;
		onAdjust(-1);
	}
</script>

<div class="relative shrink-0">
	<!-- Badge: its own distinct hit area; de-emphasised at 1. -->
	<button
		onclick={toggle}
		class="flex items-center justify-center rounded-lg px-3 text-base font-semibold {muted
			? 'text-[var(--color-text-secondary)]/50'
			: 'bg-[var(--color-primary)]/10 text-[var(--color-accent)] active:bg-[var(--color-primary)]/20'}"
		style="min-height: 44px; min-width: 44px;"
		aria-label={`${label ? label + ': ' : ''}quantity ${value}. Tap to adjust.`}
		aria-haspopup="true"
		aria-expanded={open}
	>
		×{value}
	</button>

	{#if open}
		<!-- Scrim: tap away to close/commit (writes are immediate per +/-). -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="fixed inset-0 z-40" onclick={close}></div>
		<div
			class="absolute right-0 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-1 shadow-lg"
			role="group"
			aria-label="Adjust quantity"
		>
			<button
				onclick={decrement}
				disabled={atFloor}
				class="flex items-center justify-center rounded-lg text-[var(--color-text)] disabled:opacity-30 active:bg-[var(--color-surface)]"
				style="min-height: 44px; min-width: 44px;"
				aria-label="Decrease quantity"
			>
				<Minus size={18} />
			</button>
			<span
				class="min-w-[2ch] text-center text-base font-semibold text-[var(--color-text)]"
				aria-live="polite"
			>
				{value}
			</span>
			<button
				onclick={increment}
				class="flex items-center justify-center rounded-lg text-[var(--color-text)] active:bg-[var(--color-surface)]"
				style="min-height: 44px; min-width: 44px;"
				aria-label="Increase quantity"
			>
				<Plus size={18} />
			</button>
		</div>
	{/if}
</div>
