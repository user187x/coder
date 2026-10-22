import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type CloudDriveSettings, PlatformAPI } from "#/api/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import CloudDriveSettingsPage from "./CloudDriveSettingsPage";

const settings = (enabled: boolean): CloudDriveSettings => ({
	canEdit: true,
	source: "chart",
	kind: "minio",
	endpoint: "http://minio:9000",
	region: "",
	bucket: "coder-user-storage",
	accessKey: "",
	hasSecret: true,
	chart: {
		kind: "minio",
		endpoint: "http://minio:9000",
		bucket: "coder-user-storage",
	},
	mountPath: "~/cloud-drive",
	status: {
		connected: true,
		error: null,
		latencyMs: 3,
		bucketExists: true,
		checkedAt: 1,
	},
	quota: { gib: 10, chartGib: 10, custom: false, min: 1, max: 10240 },
	enabled,
	turnedOff: enabled ? null : { by: "admin", at: 1_760_000_000 },
});

describe("CloudDriveSettingsPage", () => {
	afterEach(() => vi.restoreAllMocks());

	it("turns the Cloud Drive off for everyone from the switch at its top, its settings below", async () => {
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		const set = vi
			.spyOn(PlatformAPI, "setCloudDriveEnabled")
			.mockResolvedValue(settings(false));
		renderWithAuth(<CloudDriveSettingsPage />);
		const toggle = await screen.findByTestId("cloud-drive-enabled-switch");
		expect(toggle).toHaveAttribute("aria-checked", "true");
		expect(screen.getByTestId("cloud-drive-settings")).toBeInTheDocument();
		// the switch comes first
		expect(
			screen
				.getByTestId("cloud-drive-enabled")
				.compareDocumentPosition(screen.getByTestId("cloud-drive-settings")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await userEvent.click(toggle);
		await waitFor(() => expect(set).toHaveBeenCalledWith(false));
	});
});
