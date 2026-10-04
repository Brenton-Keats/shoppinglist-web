<script lang="ts">
	import { X } from '@lucide/svelte';
	import Button from './Button.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import type { Section, Store } from '$lib/types';

	interface Props {
		open: boolean;
		initialName?: string;
		sections: Section[];
		stores: Store[];
		onCreate: (name: string, sectionId: string | null, storeId: string | null) => void;
		onCancel: () => void;
	}

	let {
		open = $bindable(),
		initialName = '',
		sections,
		stores,
		onCreate,
		onCancel
	}: Props = $props();

	let name = $state('');
	let sectionId = $state<string>('');
	let storeId = $state<string>('');
	let nameInput: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (open) {
			name = initialName;
			sectionId = '';
			storeId = '';
			uiStore.dialogOpen = true;
			// Focus the name input after the dialog renders
			setTimeout(() => nameInput?.focus(), 50);
		} else {
			uiStore.dialogOpen = false;
		}
	});

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!name.trim()) return;

		onCreate(
			name.trim(),
			sectionId || null,
			storeId || null
		);
		open = false;
	}

	function handleCancel() {
		open = false;
		onCancel();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleCancel();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-item-title"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && handleCancel()}
	>
		<!-- Backdrop -->
		<div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"></div>

		<!-- Dialog panel - slides up from bottom on mobile, centered on desktop -->
		<div class="relative w-full max-w-md rounded-t-3xl bg-[var(--color-bg)] px-5 pt-3 pb-6 shadow-2xl sm:rounded-2xl sm:pb-5"
			style="margin-bottom: 0; padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));"
		>
			<!-- Drag handle indicator for mobile -->
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border)] sm:hidden"></div>

			<div class="mb-4 flex items-center justify-between">
				<h2 id="add-item-title" class="text-xl font-semibold text-[var(--color-text)]">New Item</h2>
				<button
					onclick={handleCancel}
					class="flex items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] transition-colors active:bg-[var(--color-surface)]"
					aria-label="Close dialog"
				>
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit} class="flex flex-col gap-3">
				<div>
					<label for="product-name" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">
						Name
					</label>
					<input
						id="product-name"
						type="text"
						bind:this={nameInput}
						bind:value={name}
						placeholder="e.g. Milk, Bread, Apples..."
						class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
						required
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="section-select" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">
							Section
						</label>
						<select
							id="section-select"
							bind:value={sectionId}
							class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
						>
							<option value="">None</option>
							{#each sections as section (section.id)}
								<option value={section.id}>{section.name}</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="store-select" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">
							Store
						</label>
						<select
							id="store-select"
							bind:value={storeId}
							class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
						>
							<option value="">None</option>
							{#each stores as store (store.id)}
								<option value={store.id}>{store.name}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="flex gap-3 pt-1">
					<Button variant="secondary" fullWidth onclick={handleCancel} type="button">
						Cancel
					</Button>
					<Button variant="primary" fullWidth type="submit">
						Add to List
					</Button>
				</div>
			</form>
		</div>
	</div>
{/if}
