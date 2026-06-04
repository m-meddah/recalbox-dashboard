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
} from '@/components/ui/sidebar'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import {
	BarChart3,
	Gamepad2,
	Gift,
	LayoutDashboard,
	Library,
	Settings,
	Trophy,
	UserRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

const NAV_ITEMS = [
	{ href: '/', labelKey: 'overview', icon: LayoutDashboard, exact: true },
	{ href: '/play-tonight', labelKey: 'playTonight', icon: Gamepad2 },
	{ href: '/stats', labelKey: 'stats', icon: BarChart3 },
	{ href: '/collection', labelKey: 'collection', icon: Library },
	{ href: '/profile', labelKey: 'profile', icon: UserRound },
	{ href: '/achievements', labelKey: 'achievements', icon: Trophy },
	{ href: '/wrapped', labelKey: 'wrapped', icon: Gift },
	{ href: '/settings', labelKey: 'settings', icon: Settings },
] as const

export function AppSidebar() {
	const t = useTranslations('nav')
	const pathname = usePathname()

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
							{NAV_ITEMS.map((item) => {
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
											render={<Link href={href} />}
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
