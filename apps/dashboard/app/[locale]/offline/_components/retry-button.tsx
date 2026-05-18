'use client'

import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function RetryButton({ label }: { label: string }) {
	return (
		<Button onClick={() => window.location.reload()}>
			<RefreshCw className="h-4 w-4 mr-2" />
			{label}
		</Button>
	)
}
