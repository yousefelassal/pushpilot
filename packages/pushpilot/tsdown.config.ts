import { defineConfig } from 'tsdown';

export default defineConfig(
	['server', 'client', 'react', 'sw', 'cli'].map((entry) => ({
		entry: [`src/${entry}/index.ts`],
		outDir: `dist/${entry}`,
		platform: 'neutral',
		target: 'es2022',
		format: 'esm',
		dts: true,
		clean: true,
		sourcemap: true,
		external: ['react', /^node:/],
		...(entry === 'react' ? { banner: '"use client";' } : {}),
	})),
);
