import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { RecalboxEventsProvider } from './recalbox-events-provider'

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
	title: 'Recalbox Dashboard',
	description: 'Self-hostable dashboard for your Recalbox retrogaming console',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={cn("font-sans", geist.variable)}>
			<body>
				<RecalboxEventsProvider>
					<header className="border-b px-6 py-3">
						<nav className="flex items-center gap-6">
							<Link href="/" className="text-sm font-semibold hover:text-primary">
								🕹️ Recalbox
							</Link>
							<Link href="/collection" className="text-sm text-muted-foreground hover:text-foreground">
								Collection
							</Link>
						</nav>
					</header>
					{children}
				</RecalboxEventsProvider>
			</body>
		</html>
	)
}
