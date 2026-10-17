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
					{ id: "app:a", kind: "app", slug: "code-server" },
					{ id: "app:b", kind: "app", slug: "novnc" },
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

	it("ignores what it does not recognise; a panel kept before kinds is an app's", () => {
		localStorage.setItem(
			"coder-ui-agent-panels:ws:main",
			JSON.stringify({
				order: ["logs", 3],
				apps: [{ id: "app:a", slug: "marimo" }, { id: "x", slug: "y" }, null],
			}),
		);
		expect(readPanels("ws", "main")).toEqual({
			order: ["logs"],
			apps: [{ id: "app:a", kind: "app", slug: "marimo" }],
		});
	});

	it("keeps ports and web pages, with what they need", () => {
		localStorage.setItem(
			"coder-ui-agent-panels:ws:main",
			JSON.stringify({
				order: [],
				apps: [
					{
						id: "app:p",
						kind: "port",
						port: 3000,
						protocol: "http",
						process: "node",
						height: 500,
					},
					{
						id: "app:w",
						kind: "web",
						url: "https://example.com/",
						name: "Docs",
					},
					{ id: "app:bad1", kind: "port", port: "3000", protocol: "http" },
					{ id: "app:bad2", kind: "port", port: 3000, protocol: "ftp" },
					{ id: "app:bad3", kind: "web" },
					{ id: "app:bad4", kind: "nonsense", slug: "x" },
				],
			}),
		);
		expect(readPanels("ws", "main").apps).toEqual([
			{
				id: "app:p",
				kind: "port",
				port: 3000,
				protocol: "http",
				process: "node",
				height: 500,
			},
			{ id: "app:w", kind: "web", url: "https://example.com/", name: "Docs" },
		]);
	});
});
