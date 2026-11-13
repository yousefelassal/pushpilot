import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DEMO_COOKIE, notify, pushHandler } from './push.server';

const app = new Hono();

app.get('/', (c) => {
	if (!getCookie(c, DEMO_COOKIE))
		setCookie(c, DEMO_COOKIE, crypto.randomUUID(), {
			httpOnly: true,
			sameSite: 'Lax',
			path: '/',
		});

	return c.html(
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width" />
				<title>pushpilot Hono example</title>
			</head>
			<body>
				<main>
					<h1>pushpilot Hono example</h1>
					<p>Subscriptions live in server memory and disappear on restart.</p>
					<p id="status">Starting</p>
					<button id="enable" disabled>
						Enable notifications
					</button>
					<button id="disable" disabled>
						Disable notifications
					</button>
					<button id="send" disabled>
						Send test notification
					</button>
				</main>
				<script type="module" src="/client.js"></script>
			</body>
		</html>,
	);
});

app.post('/api/push', (c) => pushHandler(c.req.raw));
app.post('/api/notify', (c) => notify(c.req.raw));
app.use('*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
