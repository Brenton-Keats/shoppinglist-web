import { generateUUID } from '$lib/db/utils';

export type ToastType = 'error' | 'info' | 'success';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
}

const DEFAULT_DURATION = 5000;

class ToastStore {
	toasts = $state<Toast[]>([]);

	show(message: string, type: ToastType = 'info', duration = DEFAULT_DURATION): string {
		const id = generateUUID();
		this.toasts = [...this.toasts, { id, type, message }];
		if (typeof window !== 'undefined' && duration > 0) {
			window.setTimeout(() => this.dismiss(id), duration);
		}
		return id;
	}

	error(message: string, duration = DEFAULT_DURATION): string {
		return this.show(message, 'error', duration);
	}

	dismiss(id: string): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();
