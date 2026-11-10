import { useLayoutEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { AdminNotesTray } from "./AdminNotesTray";
import { SettingsResourceTray } from "./SettingsResourceTray";
import { settingsPanelLayout } from "./settingsPanelLayout";

/** Shares the menu's vertical rail between the shortcut and notes drawers. */
export const SettingsSidePanels = ({
	container,
	surface,
	anchor,
	...resources
}: Omit<
	React.ComponentProps<typeof SettingsResourceTray>,
	"placement" | "onElement"
> & {
	container: HTMLElement | null;
	surface: HTMLElement | null;
	anchor: HTMLElement | null;
}) => {
	const [resourcePanel, setResourcePanel] = useState<HTMLDivElement | null>(
		null,
	);
	const [notesPanel, setNotesPanel] = useState<HTMLDivElement | null>(null);
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save panel position.")),
	});
	const [resourceTop, setResourceTop] = useState<number | null>(null);
	const [notesTop, setNotesTop] = useState<number | null>(null);
	const [bounds, setBounds] = useState({
		height: 0,
		viewport: 0,
		topInset: 0,
		width: 0,
		anchorTop: 0,
		anchorVisible: false,
		resourceHeight: 164,
		notesHeight: 124,
		edge: "right" as "left" | "right",
	});
	useLayoutEffect(() => {
		if (!container || !surface) return;
		const navbar = document.querySelector(".navbar-soft");
		const links = resourcePanel?.querySelector<HTMLElement>(
			".settings-resource-tray-links",
		);
		const measure = () => {
			const menu = container.getBoundingClientRect();
			const metric = anchor?.getBoundingClientRect();
			const docked = container.hasAttribute("data-settings-docked");
			// On the screen's left (ProxyMenu), the trays sit on the menu's right and the notes open rightward.
			const edge: "left" | "right" =
				container.getAttribute("data-settings-edge") === "left"
					? "left"
					: "right";
			const viewport = Math.max(
				0,
				Math.min(
					window.innerHeight - menu.top - 8,
					docked ? menu.height : Number.POSITIVE_INFINITY,
				),
			);
			const topInset = docked
				? Math.max(0, (navbar?.getBoundingClientRect().bottom ?? 0) - menu.top)
				: 0;
			const notesSpace = resources.images && metric?.height ? 136 : 0;
			// Reserve room for the full strip even when the settings list has only one row.
			const linksHeight = links?.offsetHeight ?? 0;
			const railHeight = Math.max(164, linksHeight + 28) + 16 + notesSpace;
			container.style.setProperty(
				"--settings-rail-height",
				`${Math.ceil(railHeight)}px`,
			);
			// The notes editor may extend below Settings, but its drag handle stays on the visible surface.
			const height = Math.min(
				surface.getBoundingClientRect().bottom - menu.top,
				viewport,
			);
			const available = Math.max(1, height - topInset - 16 - notesSpace - 28);
			container.style.setProperty(
				"--settings-links-scale",
				String(Math.min(1, available / Math.max(1, linksHeight))),
			);
			const next = {
				height,
				viewport,
				topInset,
				width: Math.max(
					0,
					Math.min(
						window.innerWidth - 24,
						edge === "left"
							? window.innerWidth - menu.right + 65 - 12
							: menu.left + (docked ? 0 : 65) - 12,
					),
				),
				anchorTop: metric ? metric.top - menu.top : 0,
				anchorVisible: Boolean(metric?.height),
				resourceHeight: resourcePanel?.getBoundingClientRect().height ?? 164,
				notesHeight: 124,
				edge,
			};
			setBounds((previous) =>
				Object.entries(next).every(
					([key, value]) => Reflect.get(previous, key) === value,
				)
					? previous
					: next,
			);
		};
		measure();
		let frame = 0;
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				measure();
			});
		};
		const observer = new ResizeObserver(schedule);
		for (const element of [
			container,
			surface,
			navbar,
			anchor,
			resourcePanel,
			notesPanel,
			links,
		]) {
			if (element) observer.observe(element);
		}
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule, true);
		return () => {
			container.style.removeProperty("--settings-rail-height");
			container.style.removeProperty("--settings-links-scale");
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener("resize", schedule);
			window.removeEventListener("scroll", schedule, true);
		};
	}, [container, surface, anchor, resourcePanel, notesPanel, resources.images]);
	const withNotes = resources.images && bounds.anchorVisible;
	const layout = settingsPanelLayout({
		...bounds,
		height: bounds.height,
		resourceTop: resourceTop ?? preferences.data?.resource_tray_top ?? 56,
		notesTop:
			notesTop ?? preferences.data?.admin_notes_tray_top ?? bounds.anchorTop,
		withNotes,
	});
	return (
		<>
			<SettingsResourceTray
				{...resources}
				onElement={setResourcePanel}
				placement={{
					...layout.resources,
					onMove: setResourceTop,
					onCommit: (top) => save.mutate({ resource_tray_top: top }),
				}}
			/>
			{resources.images && (
				<AdminNotesTray
					hidden={!withNotes}
					onElement={setNotesPanel}
					maxWidth={bounds.width}
					edge={bounds.edge}
					railViewport={Math.max(0, bounds.viewport - 8)}
					placement={{
						...layout.notes,
						onMove: setNotesTop,
						onCommit: (top) => save.mutate({ admin_notes_tray_top: top }),
					}}
				/>
			)}
		</>
	);
};
