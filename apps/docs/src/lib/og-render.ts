import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { render } from 'takumi-js';
import { container, text } from 'takumi-js/helpers';
import { OG_DIMENSIONS, type DocumentationCard } from './og';

const require = createRequire(import.meta.url);
const fonts = Promise.all(
	[400, 700].map(async (weight) => ({
		name: 'Atkinson',
		weight,
		data: await readFile(
			require.resolve(
				`@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${weight}-normal.woff`,
			),
		),
	})),
);

/** Build-only renderer. Font bytes come from the installed OFL-licensed package. */
export async function renderDocumentationCard(card: DocumentationCard) {
	return render(
		container({
			style: {
				...OG_DIMENSIONS,
				backgroundColor: '#10121b',
				color: '#f3f5ff',
				fontFamily: 'Atkinson',
				display: 'flex',
				flexDirection: 'column',
				padding: 64,
				position: 'relative',
				overflow: 'hidden',
			},
			children: [
				container({
					style: {
						position: 'absolute',
						inset: 24,
						border: '1px solid #30374e',
						borderRadius: 20,
					},
				}),
				container({
					style: { display: 'flex', alignItems: 'center', gap: 18 },
					children: [
						container({
							style: {
								width: 38,
								height: 38,
								borderRadius: 11,
								backgroundColor: '#7497ff',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							},
							children: [
								text('↑', { color: '#10121b', fontSize: 30, fontWeight: 700 }),
							],
						}),
						text('pushpilot', { fontSize: 32, fontWeight: 700 }),
					],
				}),
				text('DOCUMENTATION', {
					color: '#91adff',
					fontSize: 18,
					letterSpacing: 3,
					marginTop: 46,
					marginBottom: 20,
				}),
				text(card.title, {
					fontSize: card.title.length > 32 ? 58 : 72,
					fontWeight: 700,
					lineHeight: 1.1,
					maxWidth: 990,
					maxHeight: 180,
					textFit: 'shrink',
					overflowWrap: 'anywhere',
				}),
				text(card.description, {
					color: '#b7c0d8',
					fontSize: 28,
					lineHeight: 1.35,
					marginTop: 24,
					maxWidth: 980,
					maxHeight: 115,
					textFit: 'shrink',
				}),
				container({
					style: {
						position: 'absolute',
						left: 64,
						right: 64,
						bottom: 58,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						borderTop: '1px solid #30374e',
						paddingTop: 22,
					},
					children: [
						text('Web Push. Your infrastructure.', {
							color: '#8995b3',
							fontSize: 21,
						}),
						container({
							style: { display: 'flex', gap: 8 },
							children: [0, 1, 2].map((i) =>
								container({
									style: {
										width: 9,
										height: 9,
										borderRadius: 5,
										backgroundColor: i === 2 ? '#91adff' : '#354465',
									},
								}),
							),
						}),
					],
				}),
			],
		}),
		{ ...OG_DIMENSIONS, fonts: await fonts, format: 'png', emoji: 'from-font' },
	);
}
