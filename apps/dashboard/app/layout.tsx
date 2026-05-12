import type { Metadata } from 'next'
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
					{children}
				</RecalboxEventsProvider>
			</body>
		</html>
	)
}
