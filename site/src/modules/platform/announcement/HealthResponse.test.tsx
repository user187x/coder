import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { HEALTH_QUERY_KEY } from "#/api/queries/debug";
import { networkReportKey } from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import {
	MockHealth,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { HealthResponse } from "./HealthResponse";

const access = vi.hoisted(() => ({ admin: false }));
vi.mock("#/contexts/auth/AuthProvider", () => ({
	useAuthContext: () => ({
		user: MockUserOwner,
		permissions: {
			viewDebugInfo: access.admin,
			editDeploymentConfig: access.admin,
		},
	}),
}));
afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
	"loads only authorized health checks (admin=%s)",
	async (admin) => {
		access.admin = admin;
		const core = vi.spyOn(API, "getHealth").mockResolvedValue(MockHealth);
		const network = vi
			.spyOn(PlatformAPI, "getNetworkReport")
			.mockResolvedValue(MockClusterNetworkReport);
		const list = vi
			.spyOn(API, "getWorkspaces")
			.mockResolvedValue({ workspaces: [MockWorkspace], count: 1 });
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		renderComponent(
			<QueryClientProvider client={client}>
				<HealthResponse />
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(
				client.getQueryData(workspaces({ q: "", limit: 1000 }).queryKey),
			).toEqual({ workspaces: [MockWorkspace], count: 1 }),
		);
		expect(list).toHaveBeenCalledWith({ q: "", limit: 1000 });
		if (admin) {
			await waitFor(() =>
				expect(client.getQueryData(HEALTH_QUERY_KEY)).toEqual(MockHealth),
			);
			await waitFor(() =>
				expect(client.getQueryData(networkReportKey)).toEqual(
					MockClusterNetworkReport,
				),
			);
		} else {
			expect(core).not.toHaveBeenCalled();
			expect(network).not.toHaveBeenCalled();
		}
	},
);

it("retries a failed workspace request", async () => {
	access.admin = false;
	const list = vi
		.spyOn(API, "getWorkspaces")
		.mockRejectedValueOnce(new Error("Offline"))
		.mockResolvedValue({ workspaces: [], count: 0 });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	renderComponent(
		<QueryClientProvider client={client}>
			<HealthResponse />
		</QueryClientProvider>,
	);
	await userEvent
		.setup()
		.click(
			await screen.findByRole("button", { name: "Retry workspace checks" }),
		);
	await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
	await waitFor(() =>
		expect(
			client.getQueryData(workspaces({ q: "", limit: 1000 }).queryKey),
		).toEqual({ workspaces: [], count: 0 }),
	);
});
