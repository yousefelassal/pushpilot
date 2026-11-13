import { handlePush } from 'pushpilot/sw';
handlePush({
	fallback: {
		title: 'pushpilot example',
		body: 'You have a new notification.',
		url: '/',
	},
});
