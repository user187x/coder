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

const optionClassName =
	"flex min-w-0 flex-1 cursor-pointer items-center justify-center border-0 p-1 text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link disabled:opacity-50";

type SettingsStripDockControlProps = {
	edge: "left" | "right";
	disabled: boolean;
	onSidePanel: () => void;
	onBreadcrumb: () => void;
};

export const SettingsStripDockControl = ({
	edge,
	disabled,
	onSidePanel,
	onBreadcrumb,
}: SettingsStripDockControlProps) => {
	const menu = useInlineMenu();
	const key = useRef<HTMLDivElement>(null);
	const openSidePanel = () => {
		menu.close();
		onSidePanel();
	};
	const options = [
		{
			label: "Thin Settings sidebar",
			description: "Keep Settings in the thin sidebar",
			icon: PanelRightDashedIcon,
			current: true,
			select: menu.close,
		},
		{
			label: "Side Panel",
			description: "Expand Settings to the sidebar panel",
			icon: edge === "left" ? PanelLeftIcon : PanelRightIcon,
			select: openSidePanel,
		},
		{
			label: "Breadcrumb",
			description: "Move Settings into the navbar breadcrumb",
			icon: PanelRightCloseIcon,
			iconClassName: "-rotate-90",
			select: () => {
				menu.close();
				onBreadcrumb();
			},
		},
	];
	if (edge === "right") options.reverse();

	return (
		<Popover open={menu.open} onOpenChange={(open) => !open && menu.close()}>
			<PopoverAnchor asChild>
				<DropdownMenuItem
					{...menu.trigger}
					ref={key}
					aria-label="Expand Settings sidebar"
					title="Expand Settings sidebar"
					aria-haspopup="dialog"
					disabled={disabled}
					className={cn(
						"settings-strip-key mx-auto shrink-0 rounded-full",
						menu.open && "invisible",
					)}
					onPointerLeave={(event) => {
						// Keep the menu from reclaiming focus as the pointer enters the pill.
						if (menu.open) event.preventDefault();
					}}
					onSelect={(event) => {
						event.preventDefault();
						openSidePanel();
					}}
				>
					<PanelRightDashedIcon aria-hidden />
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
					{options.map(
						(
							{
								label,
								description,
								icon: Icon,
								iconClassName,
								current,
								select,
							},
							index,
						) => (
							<Tooltip key={label}>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={label}
										aria-current={current}
										className={cn(
											optionClassName,
											index > 0 && "border-l border-solid border-border",
										)}
										disabled={disabled}
										onClick={select}
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
};
