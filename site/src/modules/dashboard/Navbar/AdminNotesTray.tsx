import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { adminNotes } from "#/api/queries/adminNotes";
import { organizations } from "#/api/queries/organizations";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { AdminNotesPanel } from "./AdminNotesPanel";
import { SettingsDrawerHandle } from "./SettingsDrawerHandle";
import type { SettingsPanelPlacement } from "./settingsPanelLayout";
import "./adminNotesTray.css";

/** Keeps notes attached to the Settings edge within the shared vertical limits. */
export const AdminNotesTray = ({
	placement,
	maxWidth,
	hidden,
	onElement,
}: {
	placement: SettingsPanelPlacement;
	maxWidth: number;
	hidden: boolean;
	onElement: React.RefCallback<HTMLDivElement>;
}) => {
	const id = useId();
	const client = useQueryClient();
	const prefs = useQuery(userUIPreferences());
	const orgs = useQuery(organizations());
	const org =
		(orgs.data?.find((org) => org.is_default) ?? orgs.data?.[0])?.id ?? "";
	const notes = useQuery({ ...adminNotes(org), retry: false });
	const unread = notes.data?.notes.filter((note) => note.unread).length ?? 0;
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(
				getErrorMessage(error, "Could not save notes panel preference."),
			),
	});
	const [visible, setVisible] = useState<boolean | null>(null);
	const locked = prefs.data?.admin_notes_tray;
	const expanded = visible ?? locked?.expanded ?? false;
	const toggle = () => {
		if (save.isPending) return;
		setVisible(!expanded);
		if (locked)
			save.mutate(
				{ admin_notes_tray: { ...locked, expanded: !expanded } },
				{ onError: () => setVisible(expanded) },
			);
	};
	const lock = (open: boolean | null) => {
		if (save.isPending) return;
		if (prefs.isLoading || prefs.isError) {
			toast.error("Load panel preferences before locking notes. Try again.");
			void prefs.refetch();
			return;
		}
		setVisible(open ?? expanded);
		save.mutate(
			{
				admin_notes_tray:
					open === null ? null : { expanded: open, lock: open ? "up" : "down" },
			},
			{ onError: () => setVisible(expanded) },
		);
	};
	const width = Math.min(360, maxWidth);
	return (
		<div
			className="settings-admin-notes-tray"
			hidden={hidden}
			ref={onElement}
			style={{
				top: placement.top,
				height: Math.min(124, placement.maxHeight),
				minHeight: Math.min(124, placement.maxHeight),
			}}
		>
			<div
				className="settings-admin-notes-handle"
				data-unread={unread > 0 || undefined}
			>
				<SettingsDrawerHandle
					position={{ x: 0, y: placement.top }}
					limits={{ minY: placement.minTop, maxY: placement.maxTop }}
					onChange={({ y }) => placement.onMove(y)}
					onCommit={({ y }) => placement.onCommit(y)}
					label="Admin notes"
					attention={
						unread
							? `${unread} unread shared ${unread === 1 ? "note" : "notes"}. Open and click each note to mark it read.`
							: undefined
					}
					expanded={expanded}
					locked={Boolean(locked)}
					busy={save.isPending}
					controls={id}
					toggle={toggle}
					lock={lock}
				/>
			</div>
			<div
				id={id}
				aria-hidden={!expanded}
				inert={!expanded}
				className="settings-admin-notes-panel"
				style={{
					position: "absolute",
					top: 0,
					left: 49 - width,
					width,
					maxHeight: placement.maxHeight,
				}}
			>
				<div className="settings-admin-notes-inner">
					<AdminNotesPanel enabled={expanded && !hidden} onClose={toggle} />
				</div>
			</div>
		</div>
	);
};
