import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { documentationCard, imageUrl, OG_DIMENSIONS } from './lib/og';

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const card = documentationCard(route.entry, import.meta.env.BASE_URL);
	if (!card) return;
	const metadata = {
		'og:title': card.title,
		'og:description': card.description,
		'og:image': imageUrl(card, context.site),
		'og:image:type': 'image/png',
		'og:image:width': String(OG_DIMENSIONS.width),
		'og:image:height': String(OG_DIMENSIONS.height),
		'og:image:alt': `${card.title} | pushpilot documentation`,
		'twitter:card': 'summary_large_image',
		'twitter:title': card.title,
		'twitter:description': card.description,
		'twitter:image': imageUrl(card, context.site),
		'twitter:image:alt': `${card.title} | pushpilot documentation`,
	};
	route.head = route.head.filter(
		({ tag, attrs }) =>
			tag !== 'meta' ||
			!Object.keys(metadata).some(
				(key) => attrs?.property === key || attrs?.name === key,
			),
	);
	for (const [key, content] of Object.entries(metadata)) {
		route.head.push({
			tag: 'meta',
			attrs: key.startsWith('og:')
				? { property: key, content }
				: { name: key, content },
		});
	}
});
