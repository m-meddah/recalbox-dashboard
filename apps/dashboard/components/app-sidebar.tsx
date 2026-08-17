'use client'

import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from '@/components/ui/sidebar'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import {
	BarChart3,
	Gamepad2,
	Gift,
	LayoutDashboard,
	Library,
	MemoryStick,
	Settings,
	ShieldUser,
	SlidersHorizontal,
	Trophy,
	UserRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

const NAV_ITEMS = [
	{ href: '/', labelKey: 'overview', icon: LayoutDashboard, exact: true },
	{ href: '/play-tonight', labelKey: 'playTonight', icon: Gamepad2 },
	{ href: '/stats', labelKey: 'stats', icon: BarChart3 },
	{ href: '/collection', labelKey: 'collection', icon: Library },
	{ href: '/bios', labelKey: 'bios', icon: MemoryStick },
	{ href: '/configuration', labelKey: 'configuration', icon: SlidersHorizontal },
	{ href: '/profile', labelKey: 'profile', icon: UserRound },
	{ href: '/achievements', labelKey: 'achievements', icon: Trophy },
	{ href: '/wrapped', labelKey: 'wrapped', icon: Gift },
	{ href: '/settings', labelKey: 'settings', icon: Settings },
] as const

export function AppSidebar({
	showAdmin = false,
	serverless = false,
}: { showAdmin?: boolean; serverless?: boolean }) {
	const t = useTranslations('nav')
	const pathname = usePathname()
	const { isMobile, setOpenMobile } = useSidebar()

	// Serverless: live recalbox.conf editing needs SSH to the box → hide it.
	const base = serverless ? NAV_ITEMS.filter((i) => i.href !== '/configuration') : NAV_ITEMS
	const navItems = showAdmin
		? [...base, { href: '/admin', labelKey: 'admin', icon: ShieldUser } as const]
		: base

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<Link
					href="/"
					className="flex h-10 items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center"
					aria-label="Recalbox"
				>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src="/recalbox/recalbox-boutons.svg" alt="" className="size-7 shrink-0" />
					<span className="truncate text-base font-semibold tracking-wide text-sidebar-foreground group-data-[collapsible=icon]:hidden">
						Recalbox
					</span>
				</Link>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{navItems.map((item) => {
								const { href, labelKey, icon: Icon } = item
								const exact = 'exact' in item && item.exact
								const isActive = exact
									? pathname === href
									: pathname === href || pathname.startsWith(`${href}/`)
								return (
									<SidebarMenuItem key={href}>
										<SidebarMenuButton
											isActive={isActive}
											tooltip={t(labelKey)}
											className={cn(
												'relative',
												isActive &&
													'text-sidebar-primary before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary',
											)}
											render={
												<Link
													href={href}
													// Every nav link visible in the viewport was being prefetched on each
													// page view, and with no Suspense boundary a prefetch rendered the
													// WHOLE destination server-side: one visit cost ~10 speculative
													// renders. Worse, `staleTimes.dynamic: 0` (next.config.ts) discards
													// the result immediately, so the render was repeated on click — the
													// prefetch bought nothing at all. A browsing session measured 191
													// page renders this way.
													prefetch={false}
													onClick={isMobile ? () => setOpenMobile(false) : undefined}
												/>
											}
										>
											<Icon />
											<span>{t(labelKey)}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								)
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<div className="flex items-center justify-center gap-1 group-data-[collapsible=icon]:flex-col">
					<ThemeToggle />
					<LanguageSwitcher />
				</div>
			</SidebarFooter>
		</Sidebar>
	)
}
