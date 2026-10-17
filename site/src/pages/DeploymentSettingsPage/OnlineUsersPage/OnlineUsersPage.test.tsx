import { screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { type OnlineUser, PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import OnlineUsersPage, { sinceText } from "./OnlineUsersPage";

const at = "2026-10-17T12:00:00Z";
const ago = (seconds: number) =>
	new Date(new Date(at).getTime() - seconds * 1000).toISOString();

const user = (over: Partial<OnlineUser>): OnlineUser => ({
	id: "u",
	username: "ann",
	name: "",
	admin: false,
	lastSeen: ago(5),
	status: "active",
	activeAt: ago(2),
	since: ago(600),
	tabs: 1,
	invisible: false,
	workspaces: [],
	...over,
});

describe("Online Users", () => {
	afterEach(() => vi.restoreAllMocks());

	it("says how long ago in words that fit a column", () => {
		const now = new Date(at).getTime();
		expect(sinceText(null, now)).toBe("—");
		expect(sinceText(ago(2), now)).toBe("now");
		expect(sinceText(ago(40), now)).toBe("40 s");
		expect(sinceText(ago(180), now)).toBe("3 min");
		expect(sinceText(ago(2 * 3600 + 300), now)).toBe("2 h 5 min");
		expect(sinceText(ago(26 * 3600), now)).toBe("1 d 2 h");
	});

	it("lists the active first, the idle greyed, and who was seen lately without a tab", async () => {
		vi.spyOn(PlatformAPI, "getPresence").mockResolvedValue({
			online: [
				user({
					id: "a",
					username: "ann",
					tabs: 2,
					workspaces: [{ id: "w", name: "dev", owner: "ann" }],
				}),
				user({
					id: "b",
					username: "bob",
					status: "idle",
					activeAt: ago(95),
					invisible: true,
				}),
			],
			recent: [
				user({
					id: "c",
					username: "cat",
					status: "offline",
					lastSeen: ago(300),
				}),
			],
			idleSeconds: 30,
			generatedAt: at,
		});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<OnlineUsersPage />
				</MemoryRouter>
			</QueryClientProvider>,
		);

		expect(await screen.findByTestId("online-count")).toHaveTextContent(
			"2 online · 1 active · 1 idle",
		);
		const now = within(screen.getByRole("table", { name: "Online now" }));
		const rows = now.getAllByTestId("online-user");
		expect(rows.map((row) => row.dataset.status)).toEqual(["active", "idle"]);
		expect(rows[0]).toHaveTextContent("Active");
		expect(rows[0]).toHaveTextContent("10 min");
		expect(within(rows[0]).getByRole("link", { name: "dev" })).toHaveAttribute(
			"href",
			"/@ann/dev",
		);
		expect(rows[1]).toHaveTextContent("Idle");
		expect(rows[1]).toHaveTextContent("1 min ago");
		expect(rows[1]).toHaveClass("text-content-secondary");

		const lately = within(screen.getByRole("table", { name: "Seen lately" }));
		expect(lately.getByTestId("online-user")).toHaveTextContent("@cat");
		expect(lately.getByTestId("online-user")).toHaveTextContent("5 min ago");
	});
});
