import { adminClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Browser-side Better Auth client. `adminClient()` mirrors the `admin()` plugin on
 * the server (lib/auth/server.ts) so `session.user.role` is present and typed.
 *
 * Role read from here is for DISPLAY ONLY — hiding a control the caller cannot use.
 * It is trivially forgeable in the browser, so every admin-only action is enforced
 * server-side (see isAdmin() in the API routes); this never becomes the gate.
 */
export const authClient = createAuthClient({ plugins: [adminClient()] })
