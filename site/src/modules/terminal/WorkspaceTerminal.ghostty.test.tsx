import { render, waitFor } from "@testing-library/react";
import { WorkspaceTerminal } from "./WorkspaceTerminal";

// jsdom draws no canvas: a stand-in for ghostty-web that records how the terminal is made and opened
const made = vi.hoisted(() => ({
	init: vi.fn(async () => {}),
	terminals: [] as {
		options: Record<string, unknown>;
		opened?: HTMLElement;
		addons: unknown[];
	}[],
}));
vi.mock("ghostty-web", () => {
	class FitAddon {
		fit = vi.fn();
		activate() {}
		dispose() {}
	}
	class Terminal {
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		record: (typeof made.terminals)[number];
		constructor(options: Record<string, unknown>) {
			this.options = { ...options };
			this.record = { options: this.options, addons: [] };
			made.terminals.push(this.record);
		}
		loadAddon(addon: unknown) {
			this.record.addons.push(addon);
		}
		open(el: HTMLElement) {
			this.record.opened = el;
		}
		attachCustomKeyEventHandler() {}
		onSelectionChange() {
			return { dispose() {} };
		}
		onResize() {
			return { dispose() {} };
		}
		onRender() {
			return { dispose() {} };
		}
		onData() {
			return { dispose() {} };
		}
		getSelection() {
			return "";
		}
		hasSelection() {
			return false;
		}
		focus() {}
		write() {}
		writeln() {}
		clear() {}
		paste() {}
		dispose() {}
	}
	return { init: made.init, Terminal, FitAddon };
});

describe("WorkspaceTerminal with Ghostty", () => {
	it("draws the terminal with Ghostty's emulator, fitted to its place", async () => {
		const { getByTestId } = render(
			<WorkspaceTerminal
				agentId={undefined}
				reconnectionToken="t"
				sessionId="s"
				renderer="ghostty"
				terminalFontFamily="JetBrains Mono"
				testId="terminal"
			/>,
		);
		await waitFor(() => expect(made.terminals).toHaveLength(1));
		expect(made.init).toHaveBeenCalled();
		const [terminal] = made.terminals;
		expect(terminal.options).toMatchObject({
			fontFamily: "JetBrains Mono",
			fontSize: 16,
		});
		expect(terminal.addons).toHaveLength(1);
		expect(getByTestId("terminal").contains(terminal.opened ?? null)).toBe(
			true,
		);
	});
});
