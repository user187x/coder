import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { PlatformAPI } from "#/api/platform";
import { MockAccountCloudDrivePeers } from "#/testHelpers/cloudDriveShares";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { DriveShareNotification } from "./DriveShareNotification";

it("closes an inbox share review without discarding unrelated URL parameters", async () => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
		MockAccountCloudDrivePeers,
	);
	const router = createMemoryRouter(
		[{ path: "/workspaces", element: <DriveShareNotification userId="me" /> }],
		{ initialEntries: ["/workspaces?driveShare=unavailable&keep=yes"] },
	);
	renderWithRouter(router);
	await userEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(router.state.location.search).toBe("?keep=yes"));
	vi.restoreAllMocks();
});
