'use client'

import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function RetryButton({ label }: { label: string }) {
	return (
		<Button onClick={() => window.location.reload()}>
			<RefreshCw className="size-4 mr-2" />
			{label}
		</Button>
	)
}
