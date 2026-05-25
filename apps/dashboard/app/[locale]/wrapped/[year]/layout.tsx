export default function WrappedYearLayout({ children }: { children: React.ReactNode }) {
	return <div className="fixed inset-0 z-50 overflow-hidden bg-[#0a0a0a]">{children}</div>
}
