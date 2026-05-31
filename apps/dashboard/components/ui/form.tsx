'use client'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import * as React from 'react'
import {
	Controller,
	type ControllerProps,
	type FieldPath,
	type FieldValues,
	FormProvider,
	useFormContext,
} from 'react-hook-form'

const Form = FormProvider

type FormFieldContextValue<
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = { name: TName }

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue)

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => (
	<FormFieldContext.Provider value={{ name: props.name }}>
		<Controller {...props} />
	</FormFieldContext.Provider>
)

type FormItemContextValue = { id: string }
const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue)

const useFormField = () => {
	const fieldContext = React.use(FormFieldContext)
	const itemContext = React.use(FormItemContext)
	const { getFieldState, formState } = useFormContext()
	const fieldState = getFieldState(fieldContext.name, formState)
	const { id } = itemContext
	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	}
}

function FormItem({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
	const id = React.useId()
	return (
		<FormItemContext.Provider value={{ id }}>
			<div ref={ref} className={cn('space-y-2', className)} {...props} />
		</FormItemContext.Provider>
	)
}
FormItem.displayName = 'FormItem'

function FormLabel({
	className,
	ref,
	...props
}: React.ComponentProps<'label'> & { ref?: React.Ref<HTMLLabelElement> }) {
	const { error, formItemId } = useFormField()
	return (
		<Label
			ref={ref}
			className={cn(error && 'text-destructive', className)}
			htmlFor={formItemId}
			{...props}
		/>
	)
}
FormLabel.displayName = 'FormLabel'

function FormControl({
	children,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
	const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
	return (
		<div
			ref={ref}
			id={formItemId}
			aria-describedby={!error ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
			aria-invalid={!!error}
			{...props}
		>
			{children}
		</div>
	)
}
FormControl.displayName = 'FormControl'

function FormDescription({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
	const { formDescriptionId } = useFormField()
	return (
		<p
			ref={ref}
			id={formDescriptionId}
			className={cn('text-sm text-muted-foreground', className)}
			{...props}
		/>
	)
}
FormDescription.displayName = 'FormDescription'

function FormMessage({
	className,
	children,
	ref,
	...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
	const { error, formMessageId } = useFormField()
	const body = error ? String(error?.message) : children
	if (!body) return null
	return (
		<p
			ref={ref}
			id={formMessageId}
			className={cn('text-sm font-medium text-destructive', className)}
			{...props}
		>
			{body}
		</p>
	)
}
FormMessage.displayName = 'FormMessage'

export {
	useFormField,
	Form,
	FormItem,
	FormLabel,
	FormControl,
	FormDescription,
	FormMessage,
	FormField,
}
