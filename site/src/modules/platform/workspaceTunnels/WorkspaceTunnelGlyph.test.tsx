import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	MockWorkspaceTunnel,
	MockWorkspaceTunnelStats,
} from "#/testHelpers/workspaceTunnels";
import {
	WorkspaceTunnelGlyph,
	workspaceTunnelPeer,
} from "./WorkspaceTunnelGlyph";

afterEach(() => vi.restoreAllMocks());

it("uses traffic measured at the current endpoint and the remote workspace name", () => {
	const targetStats = {
		...MockWorkspaceTunnelStats,
		ports: [{ protocol: "tcp" as const, local_port: 8080, remote_port: 40320 }],
	};
	const tunnel = {
		...MockWorkspaceTunnel,
		source_workspace_name: "Alpha",
		target_workspace_name: "Beta",
		source_stats: MockWorkspaceTunnelStats,
		target_stats: targetStats,
	};
	const source = workspaceTunnelPeer(tunnel, tunnel.source_workspace_id, []);
	expect(source.name).toBe("Beta");
	expect(source.address).toBe(tunnel.target_address);
	expect(source.stats).toBe(MockWorkspaceTunnelStats);
	const target = workspaceTunnelPeer(tunnel, tunnel.target_workspace_id, []);
	expect(target.name).toBe("Alpha");
	expect(target.address).toBe(tunnel.source_address);
	expect(target.stats).toBe(targetStats);
});

it.each(["hover", "focus"])(
	"loads missing workspace names on %s",
	async (method) => {
		vi.spyOn(PlatformAPI, "getWorkspaceTunnels").mockResolvedValue({
			tunnels: [MockWorkspaceTunnel],
		});
		const names = vi
			.spyOn(API, "getWorkspaces")
			.mockResolvedValue({ workspaces: [], count: 0 });
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<WorkspaceTunnelGlyph
					workspace={{
						...MockWorkspace,
						id: MockWorkspaceTunnel.source_workspace_id,
					}}
				/>
			</QueryClientProvider>,
		);
		const user = userEvent.setup();
		const button = await screen.findByRole("button", {
			name: "Workspace tunnels: 1 connected",
		});
		expect(names).not.toHaveBeenCalled();
		if (method === "hover") await user.hover(button);
		else await user.tab();
		await waitFor(() => expect(names).toHaveBeenCalled());
	},
);
