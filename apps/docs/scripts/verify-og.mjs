import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';

const cards = JSON.parse(await readFile('.astro/og-cards.json', 'utf8'));
const output = path.resolve('dist');
const origin = process.env.DOCS_SITE_ORIGIN;
const base = process.env.DOCS_VERIFY_BASE || '/';
const prefix = `${base.replace(/\/$/, '')}/`;
const expectedPages = new Map(
	cards.map((card) => [
		card.pagePath.slice(prefix.length) + 'index.html',
		card,
	]),
);
const expectedImages = new Set(
	cards.map((card) => card.imagePath.slice(prefix.length)),
);
assert(
	cards.length > 0,
	'The public documentation inventory must not be empty',
);
assert.equal(expectedPages.size, cards.length, 'Page paths must be unique');
assert.equal(expectedImages.size, cards.length, 'Image paths must be unique');

async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const filename = path.join(directory, entry.name);
				return entry.isDirectory() ? files(filename) : [filename];
			}),
		)
	).flat();
}

function elements(node, name) {
	return [
		...(node.tagName === name ? [node] : []),
		...(node.childNodes ?? []).flatMap((child) => elements(child, name)),
	];
}

const builtFiles = await files(output);
for (const filename of builtFiles) {
	const relative = path.relative(output, filename).split(path.sep).join('/');
	if (relative.startsWith('og/') && relative.endsWith('.png')) {
		assert(expectedImages.delete(relative), `Unexpected image ${relative}`);
		const png = await readFile(filename);
		assert.deepEqual(
			png.subarray(0, 8),
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			`${relative} PNG signature`,
		);
		assert.equal(
			png.toString('ascii', 12, 16),
			'IHDR',
			`${relative} PNG header`,
		);
		assert.equal(png.readUInt32BE(16), 1200, `${relative} width`);
		assert.equal(png.readUInt32BE(20), 630, `${relative} height`);
		assert(png.length > 10000, `${relative} must contain rendered content`);
	}
	if (relative.endsWith('.js')) {
		assert(
			!/(?:takumi-js|@takumi-rs|atkinson-hyperlegible)/.test(
				await readFile(filename, 'utf8'),
			),
			`${relative} must not contain the build-only renderer or fonts`,
		);
	}
	if (!relative.endsWith('.html')) continue;
	const document = parse(await readFile(filename, 'utf8'));
	const metas = elements(document, 'meta').map((node) =>
		Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
	);
	const metadata = (key) => {
		const matches = metas.filter(
			(attrs) => attrs.name === key || attrs.property === key,
		);
		assert.equal(matches.length, 1, `${relative} must have exactly one ${key}`);
		return matches[0].content;
	};
	if (relative === '404.html') {
		assert(
			!metas.some((attrs) =>
				['og:image', 'twitter:image'].includes(attrs.name || attrs.property),
			),
			'404 must not advertise a public card',
		);
		continue;
	}
	const card = expectedPages.get(relative);
	assert(card, `Unexpected public HTML page ${relative}`);
	expectedPages.delete(relative);
	const image = origin ? new URL(card.imagePath, origin).href : card.imagePath;
	assert.equal(metadata('og:image'), image, `${relative} OG image`);
	assert.equal(metadata('twitter:image'), image, `${relative} Twitter image`);
	assert.equal(metadata('og:image:type'), 'image/png');
	assert.equal(metadata('og:image:width'), '1200');
	assert.equal(metadata('og:image:height'), '630');
	assert.equal(metadata('twitter:card'), 'summary_large_image');
	for (const network of ['og', 'twitter']) {
		assert.equal(
			metadata(`${network}:title`),
			card.title,
			`${relative} ${network} title`,
		);
		assert.equal(
			metadata(`${network}:description`),
			card.description,
			`${relative} ${network} description`,
		);
		assert.equal(
			metadata(`${network}:image:alt`),
			`${card.title} | pushpilot documentation`,
		);
	}
	assert.equal(metadata('description'), card.description);
	const canonical = elements(document, 'link')
		.map((node) =>
			Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
		)
		.filter((attrs) => attrs.rel === 'canonical');
	if (origin) {
		assert.equal(canonical.length, 1);
		assert.equal(canonical[0].href, new URL(card.pagePath, origin).href);
		assert.equal(metadata('og:url'), canonical[0].href);
	} else {
		assert(
			!canonical.some((attrs) => attrs.href),
			`${relative} must not invent an origin`,
		);
		assert(
			!metas.some((attrs) => attrs.property === 'og:url' && attrs.content),
			`${relative} must not invent an OG URL`,
		);
	}
}
assert.equal(
	expectedPages.size,
	0,
	`Missing HTML pages ${[...expectedPages.keys()].join(', ')}`,
);
assert.equal(
	expectedImages.size,
	0,
	`Missing PNGs ${[...expectedImages].join(', ')}`,
);
assert(
	!builtFiles.some((file) =>
		/(?:og-cards\.json|\.woff2?$|takumi)/i.test(path.relative(output, file)),
	),
	'Build-only inventory, fonts, and renderer must stay out of published output',
);
console.log(
	`Verified ${cards.length} public documentation pages and 1200x630 PNGs.`,
);
