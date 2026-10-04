<script lang="ts">
	import { Home, ShoppingCart, Clock, Settings } from '@lucide/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const tabs = [
		{ path: '/', label: 'List', icon: Home },
		{ path: '/shopping', label: 'Shop', icon: ShoppingCart },
		{ path: '/history', label: 'History', icon: Clock },
		{ path: '/settings', label: 'Settings', icon: Settings }
	];

	const activePath = $derived(page.url.pathname);
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] bg-[var(--color-bg)]"
	style="padding-bottom: var(--safe-area-bottom)"
>
	<div class="flex h-16 items-stretch">
		{#each tabs as tab}
			{@const fullPath = resolve(tab.path)}
			{@const isActive = activePath === fullPath || (tab.path === '/' && activePath === resolve('/'))}
			<a
				href={fullPath}
				class="flex flex-1 flex-col items-center justify-center gap-1 transition-colors
					{isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}"
				aria-label={tab.label}
				aria-current={isActive ? 'page' : undefined}
			>
				<tab.icon size={20} strokeWidth={isActive ? 2.5 : 1.75} />
				<span class="text-[10px] font-medium">{tab.label}</span>
			</a>
		{/each}
	</div>
</nav>
