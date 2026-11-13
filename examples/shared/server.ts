import { createPush, type PushSubscriptionRecord } from 'pushpilot/server';

export function createDemo(env: Record<string, string | undefined>) {
	const secret = env.DEMO_SECRET;
	if (!secret || secret.length < 16)
		throw new Error(
			'Set DEMO_SECRET to at least 16 characters for this local demo.',
		);
	const push = createPush({
		vapid: {
			publicKey: env.VAPID_PUBLIC_KEY,
			privateKey: env.VAPID_PRIVATE_KEY,
			subject: env.VAPID_SUBJECT,
		},
	});
	const subscriptions = new Map<string, PushSubscriptionRecord>();
	const authorized = (request: Request) =>
		request.headers.get('authorization') === `Bearer ${secret}`;
	const forbidden = () =>
		new Response(null, {
			status: 401,
			headers: { 'cache-control': 'no-store' },
		});
	const handler = push.handler({
		onSubscribe({ request, subscription, previousEndpoint }) {
			if (!authorized(request)) return forbidden();
			if (previousEndpoint) subscriptions.delete(previousEndpoint);
			subscriptions.set(subscription.endpoint, subscription);
		},
		onUnsubscribe({ request, endpoint }) {
			if (!authorized(request)) return forbidden();
			subscriptions.delete(endpoint);
		},
	});
	async function notify(request: Request): Promise<Response> {
		if (!authorized(request)) return forbidden();
		if (
			request.headers.has('origin') &&
			request.headers.get('origin') !== new URL(request.url).origin
		)
			return new Response(null, { status: 403 });
		const selected = [...subscriptions.values()];
		const report = await push.send(selected, {
			title: 'Hello from pushpilot',
			body: 'Your local example is working.',
			url: '/',
		});
		for (const result of report.results)
			if (result.status === 'gone') {
				const row = selected[result.index];
				if (row) subscriptions.delete(row.endpoint);
			}
		return Response.json(report, { headers: { 'cache-control': 'no-store' } });
	}
	return { handler, notify };
}
