import { useId } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import "#/modules/platform/buildFooter/buildFooter.css";
import "./settingsResourceTray.css";

/** Visibility and locking do not change the handle's anchor on the rail. */
export const SettingsTrayHandle = ({
	label,
	attention,
	instructions,
	horizontal = false,
	expanded,
	locked,
	busy,
	controls,
	toggle,
	lock,
}: {
	label: string;
	attention?: string;
	instructions?: string;
	horizontal?: boolean;
	expanded: boolean;
	locked?: boolean;
	busy: boolean;
	controls: string;
	toggle: () => void;
	lock: (expanded: boolean | null) => void;
}) => {
	const id = useId();
	return (
		<>
			<span className="sr-only" id={`${id}-instructions`}>
				{attention} Double-click or press Enter to show or hide. Click either
				dimple to lock or unlock the current visibility. Right-click for lock
				open and lock closed. {instructions}
			</span>
			<span className="sr-only" role="status">
				{busy
					? "Saving panel preference."
					: locked
						? `${label} locked ${expanded ? "open" : "closed"}.`
						: `${label} unlocked.`}
			</span>
			{(horizontal ? ["left", "right"] : ["top", "bottom"]).map((edge) => (
				<DropdownMenuItem
					key={edge}
					role="menuitemcheckbox"
					aria-checked={Boolean(locked)}
					aria-label={`${locked ? "Unlock" : "Lock"} ${label.toLowerCase()} (${edge} dimple)`}
					disabled={busy}
					className="settings-resource-tray-dimple"
					data-edge={edge}
					data-locked={locked || undefined}
					title={`${locked ? "Unlock" : "Lock"} ${label.toLowerCase()}`}
					onSelect={(event) => {
						event.preventDefault();
						lock(locked ? null : expanded);
					}}
				>
					<span aria-hidden />
				</DropdownMenuItem>
			))}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<DropdownMenuItem
						data-settings-panel-grip
						aria-label={`${expanded ? "Hide" : "Show"} ${label.toLowerCase()}`}
						aria-expanded={expanded}
						aria-controls={controls}
						aria-describedby={`${id}-instructions`}
						aria-disabled={busy}
						title={`${attention ? `${attention} ` : ""}${locked ? "Locked" : "Unlocked"}. Double-click to show or hide. ${instructions ?? ""}`}
						className="settings-resource-tray-toggle"
						onSelect={(event) => event.preventDefault()}
						onDoubleClick={(event) => {
							event.preventDefault();
							if (!busy) toggle();
						}}
						onContextMenu={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (busy) return;
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								toggle();
							} else if (
								event.shiftKey &&
								["ArrowUp", "ArrowDown", "Home"].includes(event.key)
							) {
								event.preventDefault();
								event.stopPropagation();
								lock(event.key === "Home" ? null : event.key === "ArrowUp");
							}
						}}
					>
						<span
							className="build-footer-grip settings-resource-tray-grip"
							aria-hidden
						/>
					</DropdownMenuItem>
				</ContextMenuTrigger>
				<ContextMenuContent
					aria-label={`${label} handle actions`}
					className="z-[2147483647]"
					onContextMenu={(event) => event.stopPropagation()}
				>
					<ContextMenuItem disabled={busy} onSelect={() => lock(true)}>
						Lock open
					</ContextMenuItem>
					<ContextMenuItem disabled={busy} onSelect={() => lock(false)}>
						Lock closed
					</ContextMenuItem>
					<ContextMenuItem
						disabled={busy || !locked}
						onSelect={() => lock(null)}
					>
						Unlock
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</>
	);
};
