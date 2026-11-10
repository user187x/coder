export type SettingsPanelPlacement = {
	top: number;
	minTop: number;
	maxTop: number;
	maxHeight: number;
	onMove: (top: number) => void;
	onCommit: (top: number) => void;
};

/** Places the admin notes drawer on the menu's side rail, inside the menu below its top inset. */
export const settingsNotesPlacement = ({
	height,
	topInset = 0,
	notesHeight,
	notesTop,
}: {
	height: number;
	topInset?: number;
	notesHeight: number;
	notesTop: number;
}) => {
	const padding = 8;
	const available = Math.max(0, height - topInset - padding * 2);
	const notes = Math.min(available, notesHeight);
	const minTop = padding + topInset;
	const maxTop = Math.max(minTop, height - padding - notes);
	return {
		top: Math.max(minTop, Math.min(maxTop, notesTop)),
		minTop,
		maxTop,
		maxHeight: available,
	};
};
