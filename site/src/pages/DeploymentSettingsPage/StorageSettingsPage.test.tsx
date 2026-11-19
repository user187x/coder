import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClusterNetworkAPI } from "#/api/clusterNetwork";
import { PlatformAPI } from "#/api/platform";
import { MockHAStorageReport } from "#/testHelpers/clusterNetwork";
import {
	MockPersistenceReport,
	MockPersistenceReportCloud,
} from "#/testHelpers/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import StorageSettingsPage from "./StorageSettingsPage";

const route = "/deployment/storage";

beforeEach(() => {
	vi.spyOn(ClusterNetworkAPI, "haAndStorage").mockResolvedValue(
		MockHAStorageReport,
	);
	vi.spyOn(ClusterNetworkAPI, "getCloudDriveCleanup").mockResolvedValue({
		scan: null,
	});
});
afterEach(() => vi.restoreAllMocks());

it("opens database endpoint details and returns focus to the map", async () => {
	vi.spyOn(PlatformAPI, "getPersistenceReport").mockResolvedValue(
		MockPersistenceReport,
	);
	const user = userEvent.setup();
	renderWithAuth(<StorageSettingsPage />, { path: route, route });
	const inspect = await screen.findByRole("button", {
		name: "Inspect database endpoint",
	});
	await user.click(inspect);
	const dialog = await screen.findByRole("dialog", {
		name: "Database endpoint",
	});
	expect(
		within(dialog).getByText(
			MockPersistenceReport.facts.coderDatabase.host ?? "",
		),
	).toBeVisible();
	await user.click(within(dialog).getByRole("button", { name: "Close" }));
	await waitFor(() => expect(inspect).toHaveFocus());
});

it("shows the configured external endpoint without a local instance to inspect", async () => {
	vi.spyOn(PlatformAPI, "getPersistenceReport").mockResolvedValue(
		MockPersistenceReportCloud,
	);
	renderWithAuth(<StorageSettingsPage />, { path: route, route });
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Inspect database endpoint" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: "Database endpoint",
	});
	expect(
		within(dialog).getByText(
			MockPersistenceReportCloud.facts.coderDatabase.host ?? "",
		),
	).toBeVisible();
	await user.keyboard("{Escape}");
	await user.click(await screen.findByRole("button", { name: "Pause" }));
	expect(screen.getByRole("button", { name: "Resume" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});
