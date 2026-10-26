/** Bulk actions exposed by a dock section to its tab's context menu. */
export type DockListActions = {
	selectAll: () => void;
	clearSelection: () => void;
	clearAll: () => void;
};
