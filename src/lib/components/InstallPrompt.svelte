<script lang="ts">
	import { onMount } from 'svelte';
	import { X, Download, Smartphone } from '@lucide/svelte';

	interface BeforeInstallPromptEvent extends Event {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let showPrompt = $state(false);
	let isInstalled = $state(false);
	let isMobile = $state(false);

	const DISMISS_KEY = 'install-prompt-dismissed';
	const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

	function checkMobile(): boolean {
		if (typeof window === 'undefined') return false;
		const userAgent = navigator.userAgent.toLowerCase();
		const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
		const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
		return isMobileDevice || isTouchDevice;
	}

	function checkInstalled(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(display-mode: standalone)').matches ||
			window.matchMedia('(display-mode: minimal-ui)').matches ||
			// @ts-expect-error iOS standalone property
			window.navigator.standalone === true;
	}

	function checkDismissed(): boolean {
		if (typeof window === 'undefined') return false;
		try {
			const dismissed = localStorage.getItem(DISMISS_KEY);
			if (!dismissed) return false;
			const timestamp = parseInt(dismissed, 10);
			return Date.now() - timestamp < DISMISS_DURATION;
		} catch {
			return false;
		}
	}

	function dismiss() {
		showPrompt = false;
		try {
			localStorage.setItem(DISMISS_KEY, Date.now().toString());
		} catch {
			// localStorage not available
		}
	}

	async function install() {
		if (!deferredPrompt) return;
		await deferredPrompt.prompt();
		const choice = await deferredPrompt.userChoice;
		if (choice.outcome === 'accepted') {
			isInstalled = true;
		}
		deferredPrompt = null;
		showPrompt = false;
	}

	onMount(() => {
		isInstalled = checkInstalled();
		isMobile = checkMobile();

		if (isInstalled || !isMobile || checkDismissed()) {
			return;
		}

		const handleBeforeInstallPrompt = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			showPrompt = true;
		};

		const handleAppInstalled = () => {
			isInstalled = true;
			showPrompt = false;
			deferredPrompt = null;
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);

		// Also check if display mode changes (e.g. user installs from browser menu)
		const mediaQuery = window.matchMedia('(display-mode: standalone)');
		const handleChange = (e: MediaQueryListEvent) => {
			if (e.matches) {
				isInstalled = true;
				showPrompt = false;
			}
		};
		mediaQuery.addEventListener('change', handleChange);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
			mediaQuery.removeEventListener('change', handleChange);
		};
	});
</script>

{#if showPrompt && !isInstalled}
	<div
		class="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
		role="alert"
		aria-live="polite"
	>
		<div class="flex items-start gap-3">
			<div class="flex-shrink-0 rounded-xl bg-[var(--color-primary)]/10 p-2">
				<Smartphone size={24} class="text-[var(--color-accent)]" />
			</div>
			<div class="flex-1">
				<h3 class="text-base-mobile font-semibold text-[var(--color-text)]">
					Install Shopping List
				</h3>
				<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
					Add to your home screen for quick access, even offline.
				</p>
				<div class="mt-3 flex gap-2">
					<button
						onclick={install}
						class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white active:bg-[var(--color-primary-dark)]"
					>
						<Download size={16} />
						Install
					</button>
					<button
						onclick={dismiss}
						class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
					>
						Not now
					</button>
				</div>
			</div>
			<button
				onclick={dismiss}
				class="flex-shrink-0 rounded-full p-1 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
				aria-label="Dismiss install prompt"
			>
				<X size={18} />
			</button>
		</div>
	</div>
{/if}
