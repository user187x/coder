import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { MockCloudDriveConnectionsOverview } from "#/testHelpers/cloudDriveConnections";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { CloudDriveConnectionsCard } from "./CloudDriveConnectionsDiagram";

describe("CloudDriveConnectionsCard", () => {
	afterEach(() => vi.restoreAllMocks());

	it("draws each user's Cloud Drive with a connector to each of its workspaces, which open their page", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveConnectionsOverview").mockResolvedValue(
			MockCloudDriveConnectionsOverview,
		);
		const { router } = renderWithAuth(<CloudDriveConnectionsCard />, {
			path: "/deployment/cloud-drive",
			route: "/deployment/cloud-drive",
			extraRoutes: [{ path: "/:username/:workspace", element: <div /> }],
		});
		const diagram = await screen.findByRole("group", {
			name: "Cloud Drive connections",
		});
		const drives = within(diagram).getAllByRole("group");
		expect(drives.map((d) => d.getAttribute("aria-label"))).toEqual([
			"ann's Cloud Drive: 1 of 3 workspaces connected",
			"bob's Cloud Drive: 2 of 2 workspaces connected",
		]);
		expect(
			within(drives[0])
				.getAllByRole("img")
				.map((edge) => edge.getAttribute("aria-label")),
		).toEqual([
			"ann's Cloud Drive to dev: connected",
			"ann's Cloud Drive to ci: disconnected by its owner",
			"ann's Cloud Drive to pairing: shared with others, so never connected",
		]);

		await userEvent.click(
			within(drives[1]).getByRole("link", {
				name: "data (bob): connected, its folder is the Cloud Drive",
			}),
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/@bob/data"),
		);
	});

	it("says so when no workspace is connected to any Cloud Drive", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveConnectionsOverview").mockResolvedValue(
			{
				drives: [
					{
						owner: { id: "u1", username: "ann" },
						encrypted: false,
						source: null,
						workspaces: [{ id: "w1", name: "dev", state: "disconnected" }],
					},
				],
			},
		);
		renderWithAuth(<CloudDriveConnectionsCard />);
		await screen.findByText("No workspaces are connected to a Cloud Drive.");
		expect(
			screen.queryByRole("group", { name: "Cloud Drive connections" }),
		).toBeNull();
	});
});
