import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ChatKeyboard, struckLabel } from "./ChatKeyboard";

const renderKeyboard = () => {
	const inputRef = createRef<HTMLTextAreaElement>();
	render(
		<>
			<textarea ref={inputRef} aria-label="Message" />
			<ChatKeyboard
				inputRef={inputRef}
				onChange={() => {}}
				onClose={() => {}}
			/>
		</>,
	);
};

describe("ChatKeyboard physical key mirroring", () => {
	it("lights the matching on-screen key while the physical key is held", () => {
		renderKeyboard();
		const key = screen.getByRole("button", { name: "q" });
		expect(key).not.toHaveAttribute("data-struck");

		fireEvent.keyDown(window, { key: "Q", code: "KeyQ" });
		expect(key).toHaveAttribute("data-struck", "true");

		fireEvent.keyUp(window, { key: "Q", code: "KeyQ" });
		expect(key).not.toHaveAttribute("data-struck");
	});

	it("tells the two Shift keys apart and releases a key whose keyup never comes", () => {
		vi.useFakeTimers();
		try {
			renderKeyboard();
			fireEvent.keyDown(window, { key: "Shift", code: "ShiftRight" });
			expect(
				screen.getByRole("button", { name: "Right Shift" }),
			).toHaveAttribute("data-struck", "true");
			expect(
				screen.getByRole("button", { name: "Left Shift" }),
			).not.toHaveAttribute("data-struck");

			act(() => vi.advanceTimersByTime(1000));
			expect(
				screen.getByRole("button", { name: "Right Shift" }),
			).not.toHaveAttribute("data-struck");
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps physical keys to on-screen labels", () => {
		expect(struckLabel({ key: "ArrowLeft", code: "ArrowLeft" })).toBe(
			"Cursor left",
		);
		expect(struckLabel({ key: " ", code: "Space" })).toBe("Space");
		expect(struckLabel({ key: "Enter", code: "Enter" })).toBe("Enter");
		expect(struckLabel({ key: "F5", code: "F5" })).toBeUndefined();
	});
});
