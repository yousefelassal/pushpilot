import { createPushClient } from 'pushpilot/client';

const status = document.querySelector<HTMLElement>('#status')!;
const enable = document.querySelector<HTMLButtonElement>('#enable')!;
const disable = document.querySelector<HTMLButtonElement>('#disable')!;
const send = document.querySelector<HTMLButtonElement>('#send')!;

const client = createPushClient();

client.listen(() => {
	const state = client.getSnapshot();
	status.textContent = state.status;
	enable.disabled = !['unsubscribed', 'error'].includes(state.status);
	disable.disabled = state.status !== 'subscribed';
	send.disabled = state.status !== 'subscribed';
});

enable.addEventListener('click', () => void client.enable());
disable.addEventListener('click', () => void client.disable());
send.addEventListener('click', async () => {
	const response = await fetch('/api/notify', { method: 'POST' });
	status.textContent = response.ok ? 'Test sent' : 'Send failed';
});

await navigator.serviceWorker.register('/sw.js');
client.start();
