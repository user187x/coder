import { cn } from "cn";
import {
	PanelLeftIcon,
	PanelRightCloseIcon,
	PanelRightDashedIcon,
	PanelRightIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
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
import { SettingsStripTooltip } from "./SettingsStripTooltip";

const settingsDockPillClassName =
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

const dockOptions = (edge: SettingsDockControlProps["edge"]) =>
	[
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

/** The thin sidebar's layout choices slide out from its single key. */
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
	const options = dockOptions(edge);
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
			<SettingsStripTooltip label={label}>
				<PopoverAnchor asChild>
					<DropdownMenuItem
						{...menu.trigger}
						ref={key}
						aria-label={label}
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
			</SettingsStripTooltip>
			<PopoverContent
				id={menu.id}
				aria-label="Settings layout"
				data-settings-strip-menu
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

/** The header pill adds the current layout on its left without moving its right edge. */
export function SettingsDockPill({
	edge,
	docked,
	hud,
	disabled,
	onChange,
}: Pick<SettingsDockControlProps, "edge" | "disabled" | "onChange"> & {
	docked: boolean;
	hud: boolean;
}) {
	const menu = useInlineMenu();
	const group = useRef<HTMLDivElement>(null);
	const { open, close } = menu;
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!group.current?.contains(event.target)
			) {
				close();
			}
		};
		document.addEventListener("pointerdown", dismiss, true);
		return () => document.removeEventListener("pointerdown", dismiss, true);
	}, [close, open]);
	const [strip, panel, breadcrumb] = dockOptions(edge);
	const options = [
		docked ? panel : breadcrumb,
		{
			...(docked ? breadcrumb : panel),
			label: docked ? "Return to dropdown" : "Dock Settings",
		},
		{
			...strip,
			label: docked
				? "Collapse Settings to shortcut icons"
				: "Dock Settings as shortcut icons",
		},
	];
	return (
		<div
			ref={group}
			role="group"
			aria-label="Docking"
			data-dock-expanded={menu.open || undefined}
			data-dock-without-hud={!hud || undefined}
			className={cn(settingsDockPillClassName, "settings-dock-pill")}
			onKeyDownCapture={(event) => {
				if (menu.open && event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					menu.anchor.current?.focus();
					menu.close();
				}
			}}
		>
			{options.map(
				({ mode, label, description, icon: Icon, iconClassName }, index) => {
					const current = index === 0;
					return (
						<Tooltip key={mode}>
							<TooltipTrigger asChild>
								<DropdownMenuItem
									{...(current ? {} : menu.trigger)}
									id={current ? menu.id : undefined}
									aria-label={label}
									aria-current={current || undefined}
									aria-hidden={current && !menu.open ? true : undefined}
									data-dock-primary={index === 1 || undefined}
									disabled={disabled || (current && !menu.open)}
									className={cn(
										"min-h-8 min-w-0 justify-center overflow-hidden rounded-none border-0 p-0",
										(index === 2 || (index === 1 && menu.open)) &&
											"border-l border-solid border-border",
									)}
									onContextMenu={(event) => {
										if (disabled) return;
										event.currentTarget.focus();
										menu.trigger.onContextMenu(event);
									}}
									onPointerLeave={(event) => event.preventDefault()}
									onPointerUp={(event) => {
										// The expanding pill can put a different segment under the right-button release.
										if (event.button !== 0) event.preventDefault();
									}}
									onSelect={(event) => {
										event.preventDefault();
										if (current) menu.anchor.current?.focus();
										else onChange(mode, !menu.open);
										menu.close();
									}}
								>
									<Icon aria-hidden className={iconClassName} />
								</DropdownMenuItem>
							</TooltipTrigger>
							<TooltipContent side="bottom">{description}</TooltipContent>
						</Tooltip>
					);
				},
			)}
		</div>
	);
}
