import { cn } from "cn";
import { BlocksIcon, HistoryIcon } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

// Platform: the workspace page's former left sidebar, folded into its top bar - Resources and History as a toggle
// pair at the bar's start (rounded rectangles, like the bar), each opening its list as a card that drops from it (over the dashboard, not beside
// it); the admin's note button after them. The page's ?sidebar= link still opens one.

export type WorkspaceNavOption = "resources" | "history";

const OPTIONS: {
	value: WorkspaceNavOption;
	label: string;
	icon: typeof BlocksIcon;
}[] = [
	{ value: "resources", label: "Resources", icon: BlocksIcon },
	{ value: "history", label: "History", icon: HistoryIcon },
];

export const WorkspaceNav: FC<{
	value: string | undefined;
	onToggle: (option: WorkspaceNavOption) => void;
	onClose: () => void;
	panels: Record<WorkspaceNavOption, ReactNode>;
	extra?: ReactNode;
}> = ({ value, onToggle, onClose, panels, extra }) => {
	const ref = useRef<HTMLDivElement>(null);
	const open = OPTIONS.find((o) => o.value === value);

	// closed by Escape, or a click anywhere else (the pill's own toggles excepted: they switch it)
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (!ref.current?.contains(target)) {
				onClose();
			}
		};
		document.addEventListener("keydown", onKey, true); // before a tooltip takes Escape
		document.addEventListener("pointerdown", onDown);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onDown);
		};
	}, [open, onClose]);

	return (
		<div ref={ref} className="flex items-center" data-testid="workspace-nav">
			<div
				role="group"
				aria-label="Workspace panels"
				className="flex items-center gap-0.5 rounded-md bg-surface-secondary p-0.5"
			>
				{OPTIONS.map(({ value: v, label, icon: Icon }) => (
					<Tooltip key={v}>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-pressed={value === v}
								aria-label={label}
								data-testid={`workspace-nav-${v}`}
								onClick={() => onToggle(v)}
								className={cn(
									"flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-content-secondary transition-colors hover:text-content-primary",
									value === v &&
										"bg-surface-primary text-content-primary shadow-sm",
								)}
							>
								<Icon className="size-icon-sm" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{label}</TooltipContent>
					</Tooltip>
				))}
			</div>
			{extra}
			{open && (
				<div
					role="dialog"
					aria-label={open.label}
					data-testid="workspace-nav-panel"
					className="absolute left-3 top-full z-40 mt-2 flex max-h-[min(70vh,640px)] w-72 flex-col overflow-y-auto rounded-2xl border border-solid border-border bg-surface-primary shadow-xl [&>div]:h-auto [&>div]:w-full [&>div]:border-r-0"
				>
					{panels[open.value]}
				</div>
			)}
		</div>
	);
};
