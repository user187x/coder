import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { answerFor } from "./BannerScrollView";
import { TerminalAnswer, uptimeText } from "./TerminalAnswers";

const ws = (name: string, status: string, completed?: string): Workspace => ({
	...MockWorkspace,
	id: name,
	name,
	latest_build: {
		...MockWorkspace.latest_build,
		status: status as Workspace["latest_build"]["status"],
		job: { ...MockWorkspace.latest_build.job, completed_at: completed },
	},
});

describe("TerminalAnswers", () => {
	afterEach(() => vi.restoreAllMocks());

	it("answers by the command: rm and its kin with the finger, the rest by name or not found", () => {
		expect(answerFor("rm")).toBe("nono");
		expect(answerFor("rm -f a")).toBe("nono");
		expect(answerFor("rmdir x")).toBe("nono");
		expect(answerFor("rm -rf *")).toBe("none"); // the broken screen
		expect(answerFor("ls")).toBe("ls");
		expect(answerFor("ls -la")).toBe("ls");
		expect(answerFor("date")).toBe("date");
		expect(answerFor("data")).toBe("date");
		expect(answerFor("whoami")).toBe("whoami");
		expect(answerFor("time")).toBe("time");
		expect(answerFor("clear")).toBe("none");
		expect(answerFor("matrix")).toBe("none");
		expect(answerFor("ip")).toBe("ip");
		expect(answerFor("ip addr")).toBe("ip");
		expect(answerFor("IP")).toBe("ip");
		expect(answerFor("pwd")).toBe("notfound");
	});

	it("counts a running workspace's uptime from its last build's end", () => {
		const now = Date.parse("2026-10-22T10:00:00Z");
		expect(uptimeText(ws("a", "running", "2026-10-22T08:20:00Z"), now)).toBe(
			"1h 40m",
		);
		expect(uptimeText(ws("b", "running", "2026-10-20T07:00:00Z"), now)).toBe(
			"2d 3h",
		);
		expect(uptimeText(ws("c", "running", "2026-10-22T09:48:00Z"), now)).toBe(
			"12m",
		);
		expect(uptimeText(ws("d", "stopped", "2026-10-22T08:20:00Z"), now)).toBe(
			"-",
		);
	});

	it("lists the user's workspaces for ls: name, state and uptime", async () => {
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [
				ws("look", "running", new Date(Date.now() - 65 * 60_000).toISOString()),
				ws("old", "stopped"),
			],
			count: 2,
		});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<TerminalAnswer answer="ls" command="ls" time={null} />
			</QueryClientProvider>,
		);
		const out = await screen.findByTestId("announcement-scroll-ls");
		const lines = [...out.children].map((c) =>
			c.textContent?.replace(/\s+/g, " ").trim(),
		);
		expect(lines).toEqual([
			"NAME STATE UPTIME",
			"look running 1h 5m",
			"old stopped -",
		]);
	});

	it("ip: the Gateway's addresses and the dashboard's host name", async () => {
		vi.spyOn(PlatformAPI, "getDashboardAddress").mockResolvedValue({
			host: "coder.example.com",
			addresses: ["10.0.0.7"],
			gateway: "traefik/traefik-gateway",
		});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<TerminalAnswer answer="ip" command="ip" time={null} />
			</QueryClientProvider>,
		);
		const out = await screen.findByTestId("announcement-scroll-ip");
		await screen.findByText("inet 10.0.0.7");
		expect(out).toHaveTextContent("host coder.example.com");
	});
});
