<script lang="ts">
	import type { Component } from 'svelte';
	import type { IconProps } from '@lucide/svelte';

	interface Props {
		icon: Component<IconProps>;
		label: string;
		size?: number;
		disabled?: boolean;
		onclick?: () => void;
		variant?: 'default' | 'primary' | 'ghost';
	}

	let {
		icon: Icon,
		label,
		size = 22,
		disabled = false,
		onclick,
		variant = 'default'
	}: Props = $props();

	const variantClasses = {
		default: 'text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]',
		primary: 'text-[var(--color-accent)] active:bg-[var(--color-surface)]',
		ghost: 'text-[var(--color-text)] active:bg-[var(--color-surface)]'
	};
</script>

<button
	aria-label={label}
	{disabled}
	onclick={onclick}
	class="inline-flex items-center justify-center rounded-full p-2.5 transition-colors disabled:opacity-40 {variantClasses[variant]}"
>
	<Icon {size} />
</button>
