'use client';

import { useEffect, useState } from 'react';
import { createPushClient } from 'pushpilot/client';
import { usePush } from 'pushpilot/react';

const client = createPushClient();

export function NotificationsButton() {
	useEffect(() => {
		void navigator.serviceWorker?.register('/sw.js');
	}, []);

	const state = usePush(client);
	const [sent, setSent] = useState<string>();

	async function sendTest() {
		const response = await fetch('/api/notify', { method: 'POST' });
		setSent(response.ok ? 'Sent. Check your notifications.' : 'Send failed.');
	}

	if (state.status === 'subscribed')
		return (
			<>
				<button onClick={() => void client.disable()}>Disable</button>
				<button onClick={() => void sendTest()}>Send test notification</button>
				{sent && <p>{sent}</p>}
			</>
		);

	return (
		<>
			<button
				disabled={state.status !== 'unsubscribed' && state.status !== 'error'}
				onClick={() => void client.enable()}
			>
				Enable notifications
			</button>
			<p>Status: {state.status}</p>
		</>
	);
}
