import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import type { Workspace } from "#/api/typesGenerated";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import {
	WorkspacesLatencyMenu,
	workspaceLatency,
} from "./WorkspacesLatencyMenu";

const withLatency = (
	name: string,
	ms: number | null,
	status = "running",
): Workspace => ({
	...MockWorkspace,
	id: name,
	name,
	latest_build: {
		...MockWorkspace.latest_build,
		status: status as Workspace["latest_build"]["status"],
		resources: [
			{
				...MockWorkspace.latest_build.resources[0],
				agents: [
					{
						...MockWorkspaceAgent,
						latency:
							ms === null
								? {}
								: {
										"Coder Embedded Relay": { latency_ms: ms, preferred: true },
									},
					},
				],
			},
		],
	},
});

describe("WorkspacesLatencyMenu", () => {
	afterEach(() => vi.restoreAllMocks());

	it("takes a workspace's latency from its agents' preferred region", () => {
		expect(workspaceLatency(withLatency("a", 12.4))).toBe(12.4);
		expect(workspaceLatency(withLatency("b", null))).toBeUndefined();
	});

	it("lists each of your workspaces with its latency, asking again while open", async () => {
		const get = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [
				withLatency("ggg", 7.2),
				withLatency("old", null, "stopped"),
			],
			count: 2,
		});
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<DropdownMenu open>
						<DropdownMenuTrigger>menu</DropdownMenuTrigger>
						<DropdownMenuContent>
							<WorkspacesLatencyMenu open />
						</DropdownMenuContent>
					</DropdownMenu>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		await waitFor(() => expect(get).toHaveBeenCalledWith({ q: "owner:me" }));
		const trigger = await screen.findByTestId("workspaces-latency");
		await waitFor(() => expect(trigger).toHaveTextContent("1 running"));
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		expect(
			await screen.findByTestId("workspace-latency-ggg"),
		).toHaveTextContent("7ms");
		expect(screen.getByTestId("workspace-latency-old")).toHaveTextContent(
			"stopped",
		);
		expect(screen.getByTestId("workspace-latency-ggg")).toHaveAttribute(
			"href",
			`/@${MockWorkspace.owner_name}/ggg`,
		);
	});
});
