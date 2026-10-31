import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { render } from "#/testHelpers/renderHelpers";
import { ChatResizeHandles } from "./ChatResizeHandles";

function ResizePanel({
	save,
}: {
	save: (size: { width: number; height: number } | null | undefined) => void;
}) {
	const dock = useRef<HTMLDivElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	return (
		<div ref={dock}>
			<div
				ref={panel}
				role="group"
				aria-label="Chat window"
				style={{ width: 420, height: 520 }}
			>
				<ChatResizeHandles dock={dock} panel={panel} onResize={save} />
			</div>
		</div>
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it.each([
	["top", 0, 100, 420, 420],
	["top left", 100, 100, 320, 420],
	["top right", 100, 100, 520, 420],
	["bottom right", -1000, -1000, 320, 240],
	["bottom left", 1000, -1000, 320, 240],
	["top right", 4000, -4000, 984, 912],
] as const)(
	"resizes from %s within minimum and viewport bounds",
	async (edge, dx, dy, width, height) => {
		const save = vi.fn();
		vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
			1200,
		);
		vi.stubGlobal("innerHeight", 1000);
		render(<ResizePanel save={save} />);
		const body = screen.getByRole("group", { name: "Chat window" });
		vi.spyOn(body, "getBoundingClientRect").mockImplementation(
			() =>
				new DOMRect(
					200,
					400,
					Number.parseFloat(body.style.width),
					Number.parseFloat(body.style.height),
				),
		);
		const grip = screen.getByRole("button", {
			name: `Resize chat from ${edge}`,
		});
		const user = userEvent.setup();
		await user.pointer([
			{ target: grip, keys: "[MouseLeft>]", coords: { x: 200, y: 400 } },
			{ target: grip, coords: { x: 200 + dx, y: 400 + dy } },
			{
				target: grip,
				keys: "[/MouseLeft]",
				coords: { x: 200 + dx, y: 400 + dy },
			},
		]);
		expect(save).toHaveBeenCalledExactlyOnceWith({ width, height });
	},
);
it("resizes with the keyboard and resets with Home", async () => {
	const save = vi.fn();
	vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
		1200,
	);
	vi.stubGlobal("innerHeight", 1000);
	render(<ResizePanel save={save} />);
	const body = screen.getByRole("group", { name: "Chat window" });
	vi.spyOn(body, "getBoundingClientRect").mockImplementation(
		() =>
			new DOMRect(
				200,
				400,
				Number.parseFloat(body.style.width),
				Number.parseFloat(body.style.height),
			),
	);
	const user = userEvent.setup();
	screen.getByRole("button", { name: "Resize chat from top" }).focus();
	await user.keyboard("{ArrowDown}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ width: 420, height: 500 }),
	);
	await user.keyboard("{Home}");
	expect(save).toHaveBeenLastCalledWith(null);
});
