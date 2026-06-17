import { createConfSectionHandlers } from '@/lib/recalbox/conf-section-route'
import { ES_COLLECTIONS_SPECS } from '@/lib/recalbox/conf-sections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { GET, POST } = createConfSectionHandlers(ES_COLLECTIONS_SPECS, 'es-collections')
