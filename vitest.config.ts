import { defineConfig } from 'vitest/config';
export default defineConfig({
	test: {
		include: ['packages/pushpilot/tests/**/*.test.ts'],
		testTimeout: 15000,
	},
});
