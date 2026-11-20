import { cn } from "cn";
import { PanelRightCloseIcon, PanelRightDashedIcon } from "lucide-react";
import { useRef } from "react";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import { useInlineMenu } from "./InlineMenu";

export const settingsDockPillClassName =
	"settings-pill flex min-h-8 items-stretch overflow-hidden rounded-full border border-solid border-border";

const optionClassName =
	"flex min-h-8 flex-1 cursor-pointer items-center justify-center border-0 p-1 text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link disabled:opacity-50";

type SettingsStripDockControlProps = {
	edge: "left" | "right";
	disabled: boolean;
	onSidePanel: () => void;
	onBreadcrumb: () => void;
};

/** The strip's layout choices open beside its key, outside the scrolling rail. */
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
					className="settings-strip-key mx-auto shrink-0 rounded-full"
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
				className="settings-menu settings-strip-dock-options overflow-visible border-0 bg-transparent shadow-none"
				onInteractOutside={(event) => {
					if (
						event.target instanceof Node &&
						key.current?.contains(event.target)
					) {
						event.preventDefault();
					}
				}}
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					menu.close();
					key.current?.focus();
				}}
			>
				<div className={settingsDockPillClassName}>
					<button
						type="button"
						aria-label="Breadcrumb"
						title="Breadcrumb"
						className={optionClassName}
						disabled={disabled}
						onClick={() => {
							menu.close();
							onBreadcrumb();
						}}
					>
						<PanelRightCloseIcon aria-hidden className="size-4 -rotate-90" />
					</button>
					<button
						type="button"
						aria-label="Side Panel"
						title="Side Panel"
						className={cn(
							optionClassName,
							"border-l border-solid border-border",
						)}
						disabled={disabled}
						onClick={openSidePanel}
					>
						<PanelRightDashedIcon aria-hidden className="size-4" />
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
};
