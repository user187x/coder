export type SettingsPanelPlacement = {
	top: number;
	minTop: number;
	maxTop: number;
	maxHeight: number;
	onMove: (top: number) => void;
	onCommit: (top: number) => void;
};

/** Resolves both footprints together so resizing cannot leave overlapping drawers. */
export const settingsPanelLayout = ({
	height,
	topInset = 0,
	resourceHeight,
	notesHeight,
	resourceTop,
	notesTop,
	withNotes,
}: {
	height: number;
	topInset?: number;
	resourceHeight: number;
	notesHeight: number;
	resourceTop: number;
	notesTop: number;
	withNotes: boolean;
}) => {
	const padding = 8;
	const gap = withNotes ? 12 : 0;
	const available = Math.max(0, height - topInset - padding * 2 - gap);
	const notesMinimum = withNotes ? Math.min(124, available / 2) : 0;
	const resourceMaximum = available - notesMinimum;
	const resources = Math.min(resourceMaximum, Math.max(164, resourceHeight));
	const notesMaximum = withNotes ? available - resources : 0;
	const notes = withNotes
		? Math.min(notesMaximum, Math.max(notesMinimum, notesHeight))
		: 0;
	const resourceY = Math.max(
		padding + topInset,
		Math.min(height - padding - resources - gap - notes, resourceTop),
	);
	const notesY = Math.max(
		resourceY + resources + gap,
		Math.min(height - padding - notes, notesTop),
	);
	return {
		resources: {
			top: resourceY,
			minTop: padding + topInset,
			maxTop: withNotes
				? notesY - gap - resources
				: height - padding - resources,
			maxHeight: resourceMaximum,
		},
		notes: {
			top: notesY,
			minTop: resourceY + resources + gap,
			maxTop: height - padding - notes,
			maxHeight: notesMaximum,
		},
	};
};
