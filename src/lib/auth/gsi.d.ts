/**
 * Minimal ambient types for Google Identity Services (GIS), the
 * accounts.google.com/gsi/client library loaded at runtime.
 * Only the surface this app uses is declared.
 */
interface GsiCredentialResponse {
	credential: string;
	select_by?: string;
}

interface GsiIdConfiguration {
	client_id: string;
	callback: (response: GsiCredentialResponse) => void;
	auto_select?: boolean;
	cancel_on_tap_outside?: boolean;
	use_fedcm_for_prompt?: boolean;
}

interface GsiButtonConfiguration {
	type?: 'standard' | 'icon';
	theme?: 'outline' | 'filled_blue' | 'filled_black';
	size?: 'large' | 'medium' | 'small';
	text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
	shape?: 'rectangular' | 'pill' | 'circle' | 'square';
	logo_alignment?: 'left' | 'center';
}

interface GsiIdApi {
	initialize(config: GsiIdConfiguration): void;
	prompt(momentListener?: (notification: unknown) => void): void;
	renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
	disableAutoSelect(): void;
	cancel(): void;
}

interface GoogleAccounts {
	id: GsiIdApi;
}

interface Window {
	google?: {
		accounts: GoogleAccounts;
	};
}
