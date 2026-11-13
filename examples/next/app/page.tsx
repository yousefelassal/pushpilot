import { NotificationsButton } from './notifications-button';

export default function Page() {
	return (
		<main>
			<h1>pushpilot Next.js example</h1>
			<p>Subscriptions live in server memory and disappear on restart.</p>
			<NotificationsButton />
		</main>
	);
}
