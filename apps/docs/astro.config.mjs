import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
export default defineConfig({
	integrations: [
		starlight({
			title: 'pushpilot',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/yousefelassal/pushpilot',
				},
			],
			sidebar: [
				{
					label: 'Start',
					items: [
						{ label: 'Overview', slug: 'index' },
						{ label: 'Quickstart', slug: 'quickstart' },
					],
				},
				{ label: 'Reference', autogenerate: { directory: 'reference' } },
				{ label: 'Guides', autogenerate: { directory: 'guides' } },
				{ label: 'Recipes', autogenerate: { directory: 'recipes' } },
			],
		}),
	],
});
