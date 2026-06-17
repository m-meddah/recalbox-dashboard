import { createConfSectionHandlers } from '@/lib/recalbox/conf-section-route'
import { VIDEO_SPECS } from '@/lib/recalbox/conf-sections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { GET, POST } = createConfSectionHandlers(VIDEO_SPECS, 'video-defaults')
