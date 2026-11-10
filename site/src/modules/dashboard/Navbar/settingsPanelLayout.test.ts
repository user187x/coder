import { settingsNotesPlacement } from "./settingsPanelLayout";

it.each([420, 600, 900])(
	"keeps the notes drawer inside a menu %s pixels tall",
	(height) => {
		for (const notesTop of [-1000, 200, 2000]) {
			const notes = settingsNotesPlacement({
				height,
				topInset: 40,
				notesHeight: 124,
				notesTop,
			});
			expect(notes.top).toBeGreaterThanOrEqual(48);
			expect(notes.top + 124).toBeLessThanOrEqual(height - 8);
			expect(notes.maxHeight).toBe(height - 56);
		}
	},
);

it("pins the drawer to the top when the menu is shorter than it", () => {
	const notes = settingsNotesPlacement({
		height: 100,
		notesHeight: 124,
		notesTop: 50,
	});
	expect(notes).toEqual({ top: 8, minTop: 8, maxTop: 8, maxHeight: 84 });
});
