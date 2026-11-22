import { cn } from "cn";
import {
	PanelLeftIcon,
	PanelRightCloseIcon,
	PanelRightDashedIcon,
	PanelRightIcon,
} from "lucide-react";
import { useRef } from "react";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useInlineMenu } from "./InlineMenu";

export const settingsDockPillClassName =
	"settings-pill flex min-h-8 items-stretch overflow-hidden rounded-full border border-solid border-border";

export type SettingsDockMode = "strip" | "panel" | "breadcrumb";

type SettingsDockControlProps = {
	edge: "left" | "right";
	mode: SettingsDockMode;
	target: SettingsDockMode;
	label: string;
	className: string;
	disabled: boolean;
	onChange: (mode: SettingsDockMode, fromTrigger?: boolean) => void;
};

/** The layout choices expand horizontally from each Settings layout control. */
export function SettingsDockControl({
	edge,
	mode,
	target,
	label,
	className,
	disabled,
	onChange,
}: SettingsDockControlProps) {
	const menu = useInlineMenu();
	const key = useRef<HTMLDivElement>(null);
	const options = [
		{
			mode: "strip",
			label: "Thin Settings sidebar",
			description: "Use the thin Settings sidebar",
			icon: PanelRightDashedIcon,
			iconClassName: undefined,
		},
		{
			mode: "panel",
			label: "Side Panel",
			description: "Use the full Settings sidebar panel",
			icon: edge === "left" ? PanelLeftIcon : PanelRightIcon,
			iconClassName: undefined,
		},
		{
			mode: "breadcrumb",
			label: "Breadcrumb",
			description: "Open Settings from the navbar breadcrumb",
			icon: PanelRightCloseIcon,
			iconClassName: "-rotate-90",
		},
	] as const;
	const original =
		options.find(
			(option) => option.mode === (mode === "strip" ? mode : target),
		) ?? options[0];
	const OriginalIcon = original.icon;
	const sequence = edge === "left" ? options : [...options].reverse();

	function choose(next: SettingsDockMode, fromTrigger = false) {
		menu.close();
		if (next !== mode) onChange(next, fromTrigger);
	}

	return (
		<Popover open={menu.open} onOpenChange={(open) => !open && menu.close()}>
			<PopoverAnchor asChild>
				<DropdownMenuItem
					{...menu.trigger}
					ref={key}
					aria-label={label}
					title={label}
					aria-haspopup="dialog"
					disabled={disabled}
					className={cn(className, menu.open && "invisible")}
					onPointerLeave={(event) => {
						if (menu.open) event.preventDefault();
					}}
					onSelect={(event) => {
						event.preventDefault();
						choose(target, true);
					}}
				>
					<OriginalIcon aria-hidden className={original.iconClassName} />
				</DropdownMenuItem>
			</PopoverAnchor>
			<PopoverContent
				id={menu.id}
				aria-label="Settings layout"
				side={edge === "left" ? "right" : "left"}
				sideOffset={0}
				avoidCollisions={false}
				className="settings-menu settings-strip-dock-options overflow-visible border-0 bg-transparent shadow-none"
				onContextMenu={menu.trigger.onContextMenu}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					if (event.target instanceof HTMLElement) event.target.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (document.activeElement === document.body) key.current?.focus();
				}}
			>
				<div className={cn(settingsDockPillClassName, "h-full min-h-0")}>
					{sequence.map(
						(
							{ mode: option, label, description, icon: Icon, iconClassName },
							index,
						) => (
							<Tooltip key={option}>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={label}
										aria-current={option === mode}
										className={cn(
											"flex min-w-0 flex-1 cursor-pointer items-center justify-center border-0 p-1 text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link disabled:opacity-50",
											index > 0 && "border-l border-solid border-border",
										)}
										disabled={disabled}
										onClick={() => choose(option)}
									>
										<Icon aria-hidden className={cn("size-4", iconClassName)} />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">{description}</TooltipContent>
							</Tooltip>
						),
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
