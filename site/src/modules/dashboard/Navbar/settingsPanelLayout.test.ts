import { settingsPanelLayout } from "./settingsPanelLayout";

it.each([420, 600, 900])(
	"contains both drawers when a menu resizes to %s pixels",
	(height) => {
		const layout = settingsPanelLayout({
			height,
			resourceHeight: 220,
			notesHeight: 300,
			resourceTop: 2000,
			notesTop: -1000,
			withNotes: true,
		});
		const resources = Math.min(220, layout.resources.maxHeight);
		const notes = Math.min(300, layout.notes.maxHeight);
		expect(layout.resources.top).toBeGreaterThanOrEqual(8);
		expect(layout.notes.top).toBeGreaterThanOrEqual(
			layout.resources.top + resources + 12,
		);
		expect(layout.notes.top + notes).toBeLessThanOrEqual(height - 8);
		expect(layout.resources.maxTop + resources + 12).toBe(layout.notes.top);
		expect(layout.notes.minTop).toBe(layout.resources.top + resources + 12);
	},
);

it("reserves room for the notes grip when shortcuts grow beyond the menu", () => {
	const layout = settingsPanelLayout({
		height: 500,
		resourceHeight: 900,
		notesHeight: 124,
		resourceTop: 56,
		notesTop: 260,
		withNotes: true,
	});
	expect(layout.resources.maxHeight).toBe(348);
	expect(layout.resources.top).toBe(8);
	expect(layout.notes.top).toBe(368);
	expect(layout.notes.maxHeight).toBe(124);
});

it("allows shortcuts to use the whole menu when notes are unavailable", () => {
	const layout = settingsPanelLayout({
		height: 500,
		resourceHeight: 220,
		notesHeight: 124,
		resourceTop: 2000,
		notesTop: 260,
		withNotes: false,
	});
	expect(layout.resources.maxHeight).toBe(484);
	expect(layout.resources.top).toBe(272);
	expect(layout.resources.maxTop).toBe(272);
});
