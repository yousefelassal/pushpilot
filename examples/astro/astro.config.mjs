import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
export default defineConfig({
	output: 'server',
	security: {
		allowedDomains: [
			{ protocol: 'http', hostname: 'localhost', port: '3000' },
			{ protocol: 'http', hostname: '127.0.0.1', port: '3000' },
		],
	},
	adapter: node({ mode: 'standalone' }),
});
