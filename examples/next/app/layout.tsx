import type { ReactNode } from 'react';
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<link rel="manifest" href="/manifest.webmanifest" />
			</head>
			<body>{children}</body>
		</html>
	);
}
