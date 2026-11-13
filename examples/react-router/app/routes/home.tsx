import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { createPushClient } from 'pushpilot/client';
import { usePush } from 'pushpilot/react';
import type { Route } from './+types/home';
import { demoUser, userIdFrom } from '../push.server';

const client = createPushClient();

export async function loader({ request }: Route.LoaderArgs) {
	if (await userIdFrom(request)) return null;

	return new Response(null, {
		headers: {
			'set-cookie': await demoUser.serialize(crypto.randomUUID()),
		},
	});
}

export default function Home() {
	useEffect(() => {
		void navigator.serviceWorker?.register('/sw.js');
	}, []);

	const state = usePush(client);
	const fetcher = useFetcher();

	return (
		<main>
			<h1>pushpilot React Router example</h1>
			<p>Subscriptions live in server memory and disappear on restart.</p>
			{state.status === 'subscribed' ? (
				<>
					<button onClick={() => void client.disable()}>Disable</button>
					<fetcher.Form method="post" action="/api/notify">
						<button disabled={fetcher.state !== 'idle'}>
							Send test notification
						</button>
					</fetcher.Form>
				</>
			) : (
				<>
					<button
						disabled={
							state.status !== 'unsubscribed' && state.status !== 'error'
						}
						onClick={() => void client.enable()}
					>
						Enable notifications
					</button>
					<p>Status: {state.status}</p>
				</>
			)}
		</main>
	);
}
