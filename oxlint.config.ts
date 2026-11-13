import { defineConfig } from 'oxlint';

export default defineConfig({
	plugins: ['typescript', 'import', 'unicorn', 'eslint'],
	env: {
		builtin: true,
		es2018: true,
	},
	ignorePatterns: [
		'.wrangler/**',
		'**/node_modules/**',
		'worker-configuration.d.ts',
		'**/next-env.d.ts',
		'**/dist/**',
		'**/.astro/**',
		'**/.next/**',
		'**/.react-router/**',
		'**/build/**',
		'examples/*/public/**',
	],
	rules: {
		'@typescript-eslint/no-floating-promises': 'warn',
		'no-var': 'error',
		'prefer-rest-params': 'error',
		'prefer-spread': 'error',
		'@typescript-eslint/ban-ts-comment': 'off',
		'@typescript-eslint/no-empty-object-type': 'off',
		'@typescript-eslint/no-explicit-any': 'off',
		'no-unused-vars': [
			'warn',
			{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
		],
		'@typescript-eslint/consistent-type-imports': [
			'warn',
			{ prefer: 'type-imports' },
		],
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],
		'no-empty': 'warn',
	},
});
