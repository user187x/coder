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
	anchor,
	...resources
}: Omit<
	React.ComponentProps<typeof SettingsResourceTray>,
	"placement" | "onElement"
> & {
	container: HTMLElement | null;
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
		width: 0,
		anchorTop: 0,
		anchorVisible: false,
		resourceHeight: 164,
		notesHeight: 124,
	});
	useLayoutEffect(() => {
		if (!container) return;
		const measure = () => {
			const menu = container.getBoundingClientRect();
			const metric = anchor?.getBoundingClientRect();
			const next = {
				height: Math.min(menu.height, window.innerHeight - menu.top - 8),
				width: Math.max(
					0,
					Math.min(window.innerWidth - 24, menu.left + 65 - 12),
				),
				anchorTop: metric ? metric.top - menu.top : 0,
				anchorVisible: Boolean(metric?.height),
				resourceHeight: resourcePanel?.getBoundingClientRect().height ?? 164,
				notesHeight: notesPanel?.getBoundingClientRect().height ?? 124,
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
		const observer = new ResizeObserver(measure);
		for (const element of [container, anchor, resourcePanel, notesPanel]) {
			if (element) observer.observe(element);
		}
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [container, anchor, resourcePanel, notesPanel]);
	const withNotes = resources.images && bounds.anchorVisible;
	const layout = settingsPanelLayout({
		...bounds,
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
