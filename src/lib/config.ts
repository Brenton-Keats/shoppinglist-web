import type { ViewMode } from '$lib/types';

export const APP_CONFIG = {
	// Sync defaults
	DEFAULT_SYNC_INTERVAL: 30, // seconds
	DEFAULT_SYNC_MODE: 'auto' as const,

	// UI defaults
	DEFAULT_VIEW_MODE: 'SECTION_STORE' as ViewMode,

	// Touch target minimum size (px)
	MIN_TOUCH_TARGET: 44,

	// App info
	APP_NAME: 'Shopping List',
	APP_SHORT_NAME: 'Shopping',
	APP_VERSION: '1.0.0'
};
