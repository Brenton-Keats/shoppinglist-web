/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// KeatsLabs brand blue scale (k-labs-branding/palette)
				primary: {
					50: '#e4f9fd', // kl-blue-100
					100: '#e4f9fd', // kl-blue-100
					200: '#b8effb', // kl-blue-200
					300: '#72ddf8', // kl-blue-300
					400: '#27c4f4', // kl-blue-400
					500: '#08aeef', // kl-blue-500 (brand primary)
					600: '#087fce', // kl-blue-600
					700: '#075ea8', // kl-blue-700
					800: '#0a2f52', // kl-blue-800
					900: '#081a2e' // kl-blue-900
				}
			},
			fontSize: {
				'xs-mobile': ['0.75rem', { lineHeight: '1rem' }],
				'sm-mobile': ['0.875rem', { lineHeight: '1.25rem' }],
				'base-mobile': ['1rem', { lineHeight: '1.5rem' }],
				'lg-mobile': ['1.125rem', { lineHeight: '1.75rem' }],
				'xl-mobile': ['1.25rem', { lineHeight: '1.75rem' }],
				'2xl-mobile': ['1.5rem', { lineHeight: '2rem' }]
			},
			spacing: {
				'touch': '44px',
				'touch-lg': '48px'
			},
			minHeight: {
				'touch': '44px',
				'touch-lg': '48px'
			},
			minWidth: {
				'touch': '44px',
				'touch-lg': '48px'
			}
		}
	},
	plugins: []
};
