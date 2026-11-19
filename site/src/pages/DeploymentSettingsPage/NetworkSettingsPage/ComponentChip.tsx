import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import type { ComponentKind } from "#/api/clusterNetwork";
import { componentIcon, KINDS } from "./componentKinds";

type ChipProps = {
	kind: ComponentKind;
	name: string;
	sub?: string | null;
	title: string;
	/** Not ok: a warning sign beside the name (the colour is the kind's, never the state's). */
	status?: "ok" | "warn" | "error";
	onOpen: () => void;
} & Omit<React.ComponentProps<"button">, "title" | "onClick">;

export const ComponentChip: React.FC<ChipProps> = ({
	kind,
	name,
	sub,
	title,
	status = "ok",
	onOpen,
	className,
	...attrs
}) => {
	const Icon = componentIcon(kind, name);
	return (
		<button
			type="button"
			title={title}
			onClick={onOpen}
			className={cn(
				"relative inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md border border-solid border-border bg-surface-secondary py-1.5 pr-2.5 pl-3 text-left text-xs leading-tight text-content-primary hover:bg-surface-tertiary",
				"before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[3px] before:rounded-sm before:bg-(--kind) before:content-['']",
				KINDS[kind].color,
				status !== "ok" &&
					"border-dashed border-content-destructive shadow-[0_0_10px_var(--color-content-destructive)]",
				className,
			)}
			data-kind={kind}
			{...attrs}
		>
			{/* Platform: what it is at a glance, just right of its colour mark (componentIcon) */}
			<Icon
				aria-hidden
				className="size-4 shrink-0 text-(--kind)"
				data-testid="component-icon"
				data-icon={Icon.displayName}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-px">
				<b className="flex w-full min-w-0 max-w-full items-center gap-1 font-semibold">
					<span className="truncate">{name}</span>
					{status !== "ok" && (
						<TriangleAlertIcon
							aria-label={status === "error" ? "failing" : "not ready"}
							className="size-3 shrink-0 text-content-destructive"
						/>
					)}
				</b>
				{sub && (
					// Platform: as wide as the chip at most (a button's flex item keeps its text's width otherwise), so it
					// truncates
					<small className="w-full min-w-0 max-w-full truncate font-mono text-[11px] text-content-secondary">
						{sub}
					</small>
				)}
			</span>
		</button>
	);
};
