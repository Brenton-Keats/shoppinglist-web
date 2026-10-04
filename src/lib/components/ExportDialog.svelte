<script lang="ts">
	import { Copy, Share2, Check, X, FileText, ClipboardCheck } from '@lucide/svelte';
	import type { ViewMode, Section, Store, ListItem, Product } from '$lib/types';
	import { exportToPlainText, copyToClipboard, shareText } from '$lib/export/text';

	interface Props {
		listName: string;
		viewMode: ViewMode;
		sections: Section[];
		stores: Store[];
		items: ListItem[];
		products: Product[];
		onClose: () => void;
	}

	let { listName, viewMode, sections, stores, items, products, onClose }: Props = $props();

	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let feedbackTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	const fullExport = $derived(
		exportToPlainText({ viewMode, sections, stores, items, products, includeChecked: true })
	);
	const uncheckedExport = $derived(
		exportToPlainText({ viewMode, sections, stores, items, products, includeChecked: false })
	);
	const hasCheckedItems = $derived(items.some((i) => i.completed));

	function showFeedback(type: 'success' | 'error', message: string) {
		if (feedbackTimeout) clearTimeout(feedbackTimeout);
		feedback = { type, message };
		feedbackTimeout = setTimeout(() => {
			feedback = null;
		}, 2500);
	}

	async function handleCopy(includeChecked: boolean) {
		const text = includeChecked ? fullExport : uncheckedExport;
		const success = await copyToClipboard(text);
		if (success) {
			showFeedback('success', includeChecked ? 'Full list copied!' : 'Unchecked items copied!');
		} else {
			showFeedback('error', 'Failed to copy to clipboard');
		}
	}

	async function handleShare(includeChecked: boolean) {
		const text = includeChecked ? fullExport : uncheckedExport;
		const success = await shareText(text, listName);
		if (success) {
			showFeedback('success', 'Shared successfully');
		} else {
			showFeedback('error', 'Sharing not available on this device');
		}
	}
</script>

<div
	class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') onClose();
	}}
	tabindex="-1"
	role="dialog"
	aria-modal="true"
	aria-label="Export list"
>
	<div
		class="flex w-full max-w-lg flex-col rounded-t-xl bg-[var(--color-bg)] shadow-xl sm:rounded-xl"
		style="max-height: 85vh;"
	>
		<div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
			<h2 class="text-base font-semibold text-[var(--color-text)]">Export List</h2>
			<button
				onclick={onClose}
				class="rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
				aria-label="Close"
			>
				<X size={20} />
			</button>
		</div>

		<div class="flex-1 overflow-y-auto p-4">
			{#if feedback}
				<div
					class="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium {feedback.type === 'success' ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-error)]/10 text-[var(--color-error)]'}"
				>
					<Check size={16} />
					{feedback.message}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<button
					onclick={() => handleCopy(true)}
					class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left active:bg-[var(--color-border)]"
				>
					<FileText size={20} class="text-[var(--color-accent)]" />
					<div class="flex-1">
						<div class="text-sm font-medium text-[var(--color-text)]">Copy full list</div>
						<div class="text-xs text-[var(--color-text-secondary)]">
							{items.length} items
						</div>
					</div>
					<Copy size={16} class="text-[var(--color-text-secondary)]" />
				</button>

				{#if hasCheckedItems}
					<button
						onclick={() => handleCopy(false)}
						class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left active:bg-[var(--color-border)]"
					>
						<ClipboardCheck size={20} class="text-[var(--color-accent)]" />
						<div class="flex-1">
							<div class="text-sm font-medium text-[var(--color-text)]">Copy unchecked items</div>
							<div class="text-xs text-[var(--color-text-secondary)]">
								{items.filter((i) => !i.completed).length} items remaining
							</div>
						</div>
						<Copy size={16} class="text-[var(--color-text-secondary)]" />
					</button>
				{/if}

				{#if typeof navigator !== 'undefined' && typeof navigator.share === 'function'}
					<button
						onclick={() => handleShare(true)}
						class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left active:bg-[var(--color-border)]"
					>
						<Share2 size={20} class="text-[var(--color-accent)]" />
						<div class="flex-1">
							<div class="text-sm font-medium text-[var(--color-text)]">Share list</div>
							<div class="text-xs text-[var(--color-text-secondary)]">
								Use your device's share sheet
							</div>
						</div>
						<Share2 size={16} class="text-[var(--color-text-secondary)]" />
					</button>
				{/if}
			</div>

			<div class="mt-4">
				<h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
					Preview
				</h3>
				<div
					class="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
				>
					<pre class="whitespace-pre-wrap text-xs text-[var(--color-text)]">{fullExport}</pre>
				</div>
			</div>
		</div>
	</div>
</div>
