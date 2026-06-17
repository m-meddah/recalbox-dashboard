import { createConfSectionHandlers } from '@/lib/recalbox/conf-section-route'
import { NETPLAY_SPECS } from '@/lib/recalbox/conf-sections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { GET, POST } = createConfSectionHandlers(NETPLAY_SPECS, 'netplay')
