import { panelOrder, readPanels } from "./agentPanelsStore";

describe("panelOrder", () => {
	it("starts with Logs then Terminal", () => {
		expect(panelOrder({ order: [], apps: [] })).toEqual(["logs", "terminal"]);
	});

	it("keeps the remembered order and appends panels it does not know", () => {
		expect(
			panelOrder({
				order: ["terminal", "app:a", "logs"],
				apps: [
					{ id: "app:a", slug: "code-server" },
					{ id: "app:b", slug: "novnc" },
				],
			}),
		).toEqual(["terminal", "app:a", "logs", "app:b"]);
	});

	it("drops removed and repeated panels", () => {
		expect(
			panelOrder({ order: ["app:gone", "logs", "logs"], apps: [] }),
		).toEqual(["logs", "terminal"]);
	});
});

describe("readPanels", () => {
	beforeEach(() => localStorage.clear());

	it("ignores what it does not recognise", () => {
		localStorage.setItem(
			"coder-ui-agent-panels:ws:main",
			JSON.stringify({
				order: ["logs", 3],
				apps: [{ id: "app:a", slug: "marimo" }, { id: "x", slug: "y" }, null],
			}),
		);
		expect(readPanels("ws", "main")).toEqual({
			order: ["logs"],
			apps: [{ id: "app:a", slug: "marimo" }],
		});
	});
});
