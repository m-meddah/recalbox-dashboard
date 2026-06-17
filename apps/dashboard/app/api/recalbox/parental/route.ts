import { createConfSectionHandlers } from '@/lib/recalbox/conf-section-route'
import { PARENTAL_SPECS } from '@/lib/recalbox/conf-sections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { GET, POST } = createConfSectionHandlers(PARENTAL_SPECS, 'parental')
