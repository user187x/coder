import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import {
	type CloudDriveSettings,
	PlatformAPI,
	type SafeSummary,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDrive } from "./CloudDrive";
import { dropRefusal } from "./CloudDriveDrop";

const GB = 1024 ** 3;

const summary: SafeSummary = {
	enabled: true,
	mountPath: "/home/coder/cloud-drive",
	usedBytes: 0,
	files: 0,
	quotaBytes: 10 * GB,
	maxUploadBytes: 5 * GB,
	volume: "ready",
};

const settings = (connected: boolean): CloudDriveSettings => ({
	canEdit: false,
	source: "chart",
	kind: "minio",
	endpoint: "http://coder-minio.coder.svc:9000",
	region: "",
	bucket: "coder-user-storage",
	accessKey: "",
	hasSecret: true,
	chart: {
		kind: "minio",
		endpoint: "http://coder-minio.coder.svc:9000",
		bucket: "coder-user-storage",
	},
	mountPath: "/home/coder/cloud-drive",
	quota: { gib: 10, chartGib: 10, custom: false, min: 1, max: 10240 },
	status: {
		connected,
		error: connected ? null : "connection refused",
		checkedAt: Date.now() / 1000,
		latencyMs: connected ? 12 : null,
	},
});

const renderDrive = () =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<CloudDrive workspaceIds={[]} />
			</MemoryRouter>
		</QueryClientProvider>,
	);

/** A drag from the computer: files (types "Files"), or anything else. */
const files = (...list: File[]) => ({
	dataTransfer: { types: ["Files"], files: list, dropEffect: "none" },
});

describe("dropRefusal", () => {
	it("takes files while the drive answers and has room, else says why", () => {
		expect(dropRefusal(summary, true, false)).toBeNull();
		expect(dropRefusal(summary, undefined, false)).toBeNull();
		expect(
			dropRefusal({ ...summary, quotaBytes: null }, true, false),
		).toBeNull();
		expect(dropRefusal(summary, false, false)?.hint).toBe(
			"Your Cloud Drive's storage does not answer",
		);
		expect(
			dropRefusal({ ...summary, usedBytes: 10 * GB }, true, false)?.message,
		).toBe(
			"Not uploaded: your Cloud Drive is full (10 GB of 10 GB). Make room in it first.",
		);
		expect(
			dropRefusal(
				{ ...summary, offline: "its workspace is stopped" },
				true,
				false,
			)?.message,
		).toBe(
			"Not uploaded: your Cloud Drive cannot be reached now (its workspace is stopped).",
		);
		expect(dropRefusal(summary, true, true)?.hint).toBe(
			"Still uploading the files dropped before",
		);
	});
});

describe("CloudDrive as a drop target", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("says a drop uploads files held over it, and lets them go when they leave", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		renderDrive();
		await screen.findByTestId("cloud-drive");
		const container = screen.getByTestId("cloud-drive-container");
		fireEvent.dragEnter(container, files(new File(["x"], "a.txt")));
		expect(container).toHaveAttribute("data-drop", "on");
		expect(screen.getByTestId("cloud-drive-drop-hint")).toHaveTextContent(
			"Drop to upload to your Cloud Drive",
		);
		// held over it: the drop is taken (the browser does not open the file)
		expect(fireEvent.dragOver(container, files())).toBe(false);
		fireEvent.dragLeave(container, { relatedTarget: document.body });
		expect(container).not.toHaveAttribute("data-drop");
		expect(screen.queryByTestId("cloud-drive-drop-hint")).toBeNull();
	});

	it("uploads dropped files to the top of the user's own drive as its window does, with progress, then a toast", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		let finish: () => void = () => {};
		const upload = vi
			.spyOn(PlatformAPI, "uploadToSafe")
			.mockImplementation(async (path, file, onProgress) => {
				onProgress?.(0.5);
				if (path === "b.txt") {
					await new Promise<void>((r) => {
						finish = r;
					});
				}
				return { ok: true, path, size: file.size };
			});
		const success = vi.spyOn(toast, "success");
		renderDrive();
		await screen.findByTestId("cloud-drive");
		const container = screen.getByTestId("cloud-drive-container");
		const a = new File(["aaaa"], "a.txt");
		const b = new File(["bbbb"], "b.txt");
		fireEvent.dragEnter(container, files(a, b));
		fireEvent.drop(container, files(a, b));
		expect(screen.queryByTestId("cloud-drive-drop-hint")).toBeNull();
		// the second file half way: three quarters of all of them, in place of the capacity bar
		const bar = await screen.findByRole("progressbar", {
			name: "Uploading b.txt to your Cloud Drive (2 of 2)",
		});
		expect(bar).toHaveAttribute("aria-valuenow", "75");
		expect(screen.queryByTestId("cloud-drive-capacity-bar")).toBeNull();
		expect(upload.mock.calls.map((c) => [c[0], c[1], c[3]])).toEqual([
			["a.txt", a, undefined],
			["b.txt", b, undefined],
		]);
		finish();
		await waitFor(() =>
			expect(success).toHaveBeenCalledWith(
				"2 files are in your Cloud Drive.",
				expect.objectContaining({
					action: expect.objectContaining({ label: "Open" }),
				}),
			),
		);
		expect(screen.queryByTestId("cloud-drive-drop-progress")).toBeNull();
		expect(screen.getByTestId("cloud-drive-capacity-bar")).toBeInTheDocument();
	});

	it("says which files did not go up", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		vi.spyOn(PlatformAPI, "uploadToSafe").mockRejectedValue(
			new Error("That file is larger than the 5 GiB an upload may be."),
		);
		const error = vi.spyOn(toast, "error");
		renderDrive();
		await screen.findByTestId("cloud-drive");
		fireEvent.drop(
			screen.getByTestId("cloud-drive-container"),
			files(new File(["x"], "big.iso")),
		);
		await waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				"Not uploaded to your Cloud Drive: big.iso (That file is larger than the 5 GiB an upload may be.).",
			),
		);
	});

	it("passes a drag of anything but files by", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		const upload = vi.spyOn(PlatformAPI, "uploadToSafe");
		renderDrive();
		await screen.findByTestId("cloud-drive");
		const container = screen.getByTestId("cloud-drive-container");
		const text = { dataTransfer: { types: ["text/plain"], files: [] } };
		fireEvent.dragEnter(container, text);
		expect(fireEvent.dragOver(container, text)).toBe(true);
		expect(container).not.toHaveAttribute("data-drop");
		expect(screen.queryByTestId("cloud-drive-drop-hint")).toBeNull();
		expect(fireEvent.drop(container, text)).toBe(true);
		expect(upload).not.toHaveBeenCalled();
	});

	it("refuses a drop, saying why, while its storage does not answer", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(false),
		);
		const upload = vi.spyOn(PlatformAPI, "uploadToSafe");
		const error = vi.spyOn(toast, "error");
		renderDrive();
		const button = await screen.findByTestId("cloud-drive");
		await waitFor(() =>
			expect(within(button).getByTestId("cloud-drive-status")).toHaveAttribute(
				"data-state",
				"disconnected",
			),
		);
		const container = screen.getByTestId("cloud-drive-container");
		fireEvent.dragEnter(container, files(new File(["x"], "a.txt")));
		expect(container).toHaveAttribute("data-drop", "refused");
		expect(screen.getByTestId("cloud-drive-drop-hint")).toHaveTextContent(
			"Your Cloud Drive's storage does not answer",
		);
		fireEvent.drop(container, files(new File(["x"], "a.txt")));
		expect(error).toHaveBeenCalledWith(
			"Not uploaded: your Cloud Drive's storage does not answer now. Try again once it is connected.",
		);
		expect(upload).not.toHaveBeenCalled();
	});

	it("reads how full it is in a pill", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue({
			...summary,
			usedBytes: 1536 * 1024 ** 2,
		});
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings(true),
		);
		renderDrive();
		const button = await screen.findByTestId("cloud-drive");
		const usage = within(button).getByTestId("cloud-drive-usage");
		expect(usage).toHaveTextContent("1.5 GB of 10 GB");
		expect(usage).toHaveClass("rounded-full", "border", "tabular-nums");
		expect(button).toHaveAccessibleName(/^Cloud Drive: 1.5 GB of 10 GB used/);
	});
});
