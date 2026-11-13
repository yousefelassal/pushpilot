import type { PushState } from './types/index.js';

/** Minimum iOS version (16.4) that supports Web Push, encoded as major + minor / 100. */
const MIN_IOS_VERSION = 16.04;

function isIos(): boolean {
	return (
		/iP(hone|ad|od)/.test(navigator.userAgent) ||
		// iPadOS reports itself as a Mac with a touch screen.
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

function isInstalledWebApp(): boolean {
	const standalone = 'standalone' in navigator && navigator.standalone === true;
	return (
		standalone ||
		Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
	);
}

function iosState(): PushState | null {
	const version = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
	if (
		version &&
		Number(version[1]) + Number(version[2]) / 100 < MIN_IOS_VERSION
	)
		return { status: 'unsupported', reason: 'ios-version' };
	if (!isInstalledWebApp()) return { status: 'needs-install' };
	return null;
}

/**
 * Returns a terminal state when push cannot work here, or `null` when the
 * browser looks capable and the caller should continue.
 */
export function platformState(): PushState | null {
	if (typeof window === 'undefined' || typeof navigator === 'undefined')
		return { status: 'unknown' };
	if (!window.isSecureContext)
		return { status: 'unsupported', reason: 'insecure-context' };

	if (isIos()) {
		const ios = iosState();
		if (ios) return ios;
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
