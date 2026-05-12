import { placeholder } from '@recalbox/scraper-core'

export default function Home() {
	return (
		<main className="p-8">
			<h1 className="text-2xl font-bold">Recalbox Dashboard</h1>
			<p className="text-sm text-muted-foreground">
				Scaffold OK. Scraper core lib import: {String(placeholder)}
			</p>
		</main>
	)
}
