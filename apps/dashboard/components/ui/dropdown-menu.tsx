'use client'

import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import * as React from 'react'

import { cn } from '@/lib/utils'

const DropdownMenu = MenuPrimitive.Root

function DropdownMenuTrigger({
	asChild,
	children,
	...props
}: MenuPrimitive.Trigger.Props & { asChild?: boolean }) {
	if (asChild && React.isValidElement(children)) {
		return (
			<MenuPrimitive.Trigger
				data-slot="dropdown-menu-trigger"
				render={children as React.ReactElement}
				{...props}
			/>
		)
	}
	return (
		<MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props}>
			{children}
		</MenuPrimitive.Trigger>
	)
}

function DropdownMenuContent({
	className,
	align = 'end',
	sideOffset = 4,
	side = 'bottom',
	children,
	...props
}: MenuPrimitive.Popup.Props &
	Pick<MenuPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				side={side}
				sideOffset={sideOffset}
				align={align}
				className="isolate z-50"
			>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						'min-w-36 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
						className,
					)}
					{...props}
				>
					{children}
				</MenuPrimitive.Popup>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	)
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="dropdown-menu-label"
			className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
			{...props}
		/>
	)
}

function DropdownMenuItem({
	className,
	children,
	asChild,
	...props
}: MenuPrimitive.Item.Props & { asChild?: boolean }) {
	const itemClassName = cn(
		"relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className,
	)
	if (asChild && React.isValidElement(children)) {
		const child = children as React.ReactElement<{ className?: string }>
		return (
			<MenuPrimitive.Item
				data-slot="dropdown-menu-item"
				render={React.cloneElement(child, {
					className: cn(itemClassName, child.props.className),
				})}
				{...props}
			/>
		)
	}
	return (
		<MenuPrimitive.Item data-slot="dropdown-menu-item" className={itemClassName} {...props}>
			{children}
		</MenuPrimitive.Item>
	)
}

function DropdownMenuSeparator({ className }: { className?: string }) {
	return (
		<div data-slot="dropdown-menu-separator" className={cn('my-1 h-px bg-border', className)} />
	)
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
}
