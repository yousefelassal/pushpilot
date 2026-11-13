export default function Home() {
	return (
		<main>
			<h1>pushpilot local example</h1>
			<p>Local demo only. Enter DEMO_SECRET below.</p>
			<label>
				Demo password <input id="password" type="password" autoComplete="off" />
			</label>
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
			<script type="module" src="/browser.js" />
		</main>
	);
}
