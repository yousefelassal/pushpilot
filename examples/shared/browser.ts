import { createPushClient } from 'pushpilot/client';

const password = document.querySelector<HTMLInputElement>('#password');
const status = document.querySelector<HTMLElement>('#status');
const enable = document.querySelector<HTMLButtonElement>('#enable');
const disable = document.querySelector<HTMLButtonElement>('#disable');
const send = document.querySelector<HTMLButtonElement>('#send');

async function authorizedFetch(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('authorization', `Bearer ${password?.value ?? ''}`);
	return fetch(url, { ...init, headers });
}
const client = createPushClient({ fetch: authorizedFetch });
client.listen(() => {
	const snapshot = client.getSnapshot();
	if (status)
		status.textContent =
			snapshot.status === 'error'
				? `error: ${snapshot.error.code}`
				: snapshot.status;
	if (enable)
		enable.disabled = !['unsubscribed', 'error'].includes(snapshot.status);
	if (disable) disable.disabled = snapshot.status !== 'subscribed';
	if (send) send.disabled = snapshot.status !== 'subscribed';
});
enable?.addEventListener('click', () => void client.enable());
disable?.addEventListener('click', () => void client.disable());
send?.addEventListener('click', async () => {
	try {
		const response = await authorizedFetch('/api/notify', { method: 'POST' });
		if (status)
			status.textContent = response.ok
				? 'Test sent. Check your notifications.'
				: `Send refused (${response.status}).`;
	} catch {
		if (status) status.textContent = 'Send failed. Check your connection.';
	}
});
try {
	const registration = await navigator.serviceWorker.register('/sw.js');
	if (!registration.active) await navigator.serviceWorker.ready;
	client.start();
} catch {
	if (status) status.textContent = 'Service worker setup failed.';
}
