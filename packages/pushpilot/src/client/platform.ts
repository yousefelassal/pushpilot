import type { PushState } from './types.js';

export function platformState(): PushState | null {
	if (typeof window === 'undefined' || typeof navigator === 'undefined')
		return { status: 'unknown' };
	if (!window.isSecureContext)
		return { status: 'unsupported', reason: 'insecure-context' };
	const ios =
		/iP(hone|ad|od)/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	if (ios) {
		const version = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
		if (version && Number(version[1]) + Number(version[2]) / 100 < 16.04)
			return { status: 'unsupported', reason: 'ios-version' };
		const standalone =
			'standalone' in navigator && navigator.standalone === true;
		if (
			!standalone &&
			!window.matchMedia?.('(display-mode: standalone)').matches
		)
			return { status: 'needs-install' };
	}
	if (!('serviceWorker' in navigator))
		return { status: 'unsupported', reason: 'no-service-worker' };
	if (!('PushManager' in window))
		return { status: 'unsupported', reason: 'no-push-manager' };
	if (!('Notification' in window))
		return { status: 'unsupported', reason: 'no-notification' };
	if (Notification.permission === 'denied') return { status: 'denied' };
	return null;
}
