import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { render } from "#/testHelpers/renderHelpers";
import { NotesResizeHandle } from "./NotesResizeHandle";

function Panel({ onResize }: { onResize: (height: number | null) => void }) {
	const panel = useRef<HTMLDivElement>(null);
	return (
		<div ref={panel} role="group" aria-label="Notes">
			<NotesResizeHandle panel={panel} height={null} onResize={onResize} />
		</div>
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("constrains pointer resizing, cancels a drag, and supports keyboard reset", async () => {
	const onResize = vi.fn();
	const user = userEvent.setup();
	vi.stubGlobal("innerHeight", 900);
	render(<Panel onResize={onResize} />);
	vi.spyOn(
		screen.getByRole("group", { name: "Notes" }),
		"getBoundingClientRect",
	).mockReturnValue(new DOMRect(500, 300, 360, 350));
	const grip = screen.getByRole("button", { name: "Resize notes panel" });
	await user.pointer([
		{ target: grip, keys: "[MouseLeft>]", coords: { y: 650 } },
		{ target: grip, coords: { y: 2000 } },
	]);
	expect(onResize).toHaveBeenLastCalledWith(588);
	await user.pointer({ target: grip, coords: { y: 100 } });
	expect(onResize).toHaveBeenLastCalledWith(280);
	await user.keyboard("{Escape}");
	expect(onResize).toHaveBeenLastCalledWith(null);
	await user.pointer({ keys: "[/MouseLeft]" });
	await user.keyboard("{ArrowDown}");
	expect(onResize).toHaveBeenLastCalledWith(370);
	await user.keyboard("{Home}");
	expect(onResize).toHaveBeenLastCalledWith(null);
});
