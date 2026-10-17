import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	type CloudDriveSettings,
	PlatformAPI,
	PlatformError,
	type SafeSummary,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDrive } from "./CloudDrive";

const summary: SafeSummary = {
	enabled: true,
	mountPath: "/home/coder/cloud-drive",
	usedBytes: 1536 * 1024 * 1024,
	files: 3,
	quotaBytes: 10 * 1024 ** 3,
	maxUploadBytes: 5 * 1024 ** 3,
	volume: "ready",
};

const settings = (
	over: Partial<CloudDriveSettings> = {},
): CloudDriveSettings => ({
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
	status: {
		connected: true,
		error: null,
		checkedAt: Date.now() / 1000 - 5,
		latencyMs: 12,
	},
	...over,
});

const renderDrive = (ids: string[] = []) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<CloudDrive workspaceIds={ids} />
		</QueryClientProvider>,
	);

const emptyListing = { path: "", folders: [], files: [] };

describe("CloudDrive", () => {
	beforeEach(() => {
		// the ropes drawn at rest, no frames to wait for
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("shows nothing where the deployment has no Cloud Drive", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getSafe")
			.mockRejectedValue(new PlatformError("not enabled", 404));
		renderDrive();
		await waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("cloud-drive")).toBeNull();
		expect(screen.queryByTestId("cloud-drive-ropes")).toBeNull();
	});

	it("is one button with how full it is and whether it is connected", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		renderDrive();
		const button = await screen.findByTestId("cloud-drive");
		expect(button).toHaveTextContent("Cloud Drive");
		expect(button).toHaveTextContent("1.5 GB of 10 GB");
		await waitFor(() =>
			expect(within(button).getByTestId("cloud-drive-status")).toHaveAttribute(
				"data-state",
				"connected",
			),
		);
		expect(button).toHaveAccessibleName(
			"Cloud Drive: 1.5 GB of 10 GB used, connected",
		);
		expect(screen.getAllByTestId("cloud-drive")).toHaveLength(1);
	});

	it("opens a window in the middle of the screen onto its files, and uploads into a folder", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		const list = vi
			.spyOn(PlatformAPI, "listSafe")
			.mockImplementation(async (path) =>
				path === ""
					? {
							path: "",
							folders: [{ name: "docs" }],
							files: [
								{
									name: "notes.txt",
									size: 2048,
									modified: "2026-10-17T05:00:00Z",
								},
							],
						}
					: { path, folders: [], files: [] },
			);
		const upload = vi
			.spyOn(PlatformAPI, "uploadToSafe")
			.mockImplementation(async (path, file, onProgress) => {
				onProgress?.(0.5);
				return { ok: true, path, size: file.size };
			});
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		const dialog = await screen.findByRole("dialog", { name: "Cloud Drive" });
		// Coder's dialog: fixed in the middle of the viewport
		expect(dialog.className).toMatch(/fixed/);
		expect(dialog.className).toMatch(/left-\[50%\]/);
		expect(dialog.className).toMatch(/top-\[50%\]/);
		expect(await screen.findByText("notes.txt")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Download notes.txt" }),
		).toHaveAttribute("href", "/__coder-ui/api/safe/download?path=notes.txt");
		expect(
			screen.getByText("In each of your workspaces at ~/cloud-drive"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "docs" }));
		await waitFor(() => expect(list).toHaveBeenCalledWith("docs"));
		expect(
			await screen.findByText("This folder is empty."),
		).toBeInTheDocument();
		const file = new File(["hello"], "a b.txt", { type: "text/plain" });
		fireEvent.change(screen.getByTestId("cloud-drive-file-input"), {
			target: { files: [file] },
		});
		await waitFor(() => expect(upload).toHaveBeenCalled());
		expect(upload.mock.calls[0][0]).toBe("docs/a b.txt");
		expect(await screen.findByText("Done")).toBeInTheDocument();
	});

	it("closes on Escape and with its close button", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue(emptyListing);
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		await screen.findByRole("dialog", { name: "Cloud Drive" });
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByTestId("cloud-drive"));
		await screen.findByRole("dialog", { name: "Cloud Drive" });
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("asks once more before deleting", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue({
			path: "",
			folders: [],
			files: [{ name: "old.log", size: 1, modified: "2026-10-17T05:00:00Z" }],
		});
		const del = vi
			.spyOn(PlatformAPI, "deleteFromSafe")
			.mockResolvedValue({ ok: true, removed: 1 });
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		fireEvent.click(
			await screen.findByRole("button", { name: "Delete old.log" }),
		);
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
		await waitFor(() => expect(del).toHaveBeenCalledWith("old.log"));
	});

	it("shows its backend read-only to a member", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue(emptyListing);
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
		const view = await screen.findByTestId("cloud-drive-settings");
		expect(view).toHaveTextContent("The cluster's own MinIO");
		expect(view).toHaveTextContent("http://coder-minio.coder.svc:9000");
		expect(view).toHaveTextContent("~/cloud-drive");
		expect(view).toHaveTextContent("Connected in 12 ms");
		expect(view).toHaveTextContent(
			"Admins choose where Cloud Drives keep their files.",
		);
		expect(screen.queryByLabelText("Endpoint")).toBeNull();
		// back to the files from the title
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Cloud Drive",
			}),
		);
		expect(
			await screen.findByTestId("cloud-drive-listing"),
		).toBeInTheDocument();
	});

	it("lets an admin test another S3 service and save it", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings({ canEdit: true }),
		);
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue(emptyListing);
		const test = vi
			.spyOn(PlatformAPI, "testCloudDriveBackend")
			.mockResolvedValue({
				connected: true,
				error: null,
				checkedAt: Date.now() / 1000,
				latencyMs: 30,
				bucketExists: false,
			});
		const save = vi
			.spyOn(PlatformAPI, "saveCloudDriveSettings")
			.mockResolvedValue(settings({ canEdit: true, source: "custom" }));
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
		const endpoint = await screen.findByLabelText("Endpoint");
		expect(screen.getByLabelText("Bucket")).toHaveValue("coder-user-storage");
		fireEvent.change(endpoint, {
			target: { value: "https://s3.example.org" },
		});
		fireEvent.change(screen.getByLabelText("Access key"), {
			target: { value: "AKIA" },
		});
		fireEvent.change(screen.getByLabelText("Secret key"), {
			target: { value: "s3cret" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
		await waitFor(() => expect(test).toHaveBeenCalled());
		expect(await screen.findByRole("status")).toHaveTextContent(
			"It answers (30 ms); the bucket will be made.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				endpoint: "https://s3.example.org",
				region: "",
				bucket: "coder-user-storage",
				accessKey: "AKIA",
				secretKey: "s3cret",
			}),
		);
	});

	it("says when its storage does not answer", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings({
				status: {
					connected: false,
					error: "connection refused",
					checkedAt: Date.now() / 1000,
					latencyMs: null,
				},
			}),
		);
		renderDrive(["w1"]);
		const button = await screen.findByTestId("cloud-drive");
		await waitFor(() =>
			expect(within(button).getByTestId("cloud-drive-status")).toHaveAttribute(
				"data-state",
				"disconnected",
			),
		);
		expect(screen.getByTestId("cloud-drive-ropes")).toHaveAttribute(
			"data-connected",
			"false",
		);
	});

	it("ropes each of the account's workspace rows to it", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		const rect = (x: number, y: number, w: number, h: number) =>
			({
				x,
				y,
				left: x,
				top: y,
				width: w,
				height: h,
				right: x + w,
				bottom: y + h,
				toJSON: () => ({}),
			}) as DOMRect;
		const rows = ["w1", "w2"].map((id, i) => {
			const row = document.createElement("div");
			row.dataset.testid = `workspace-${id}`;
			row.getBoundingClientRect = () => rect(0, 100 + i * 60, 800, 50);
			document.body.appendChild(row);
			return row;
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				return this.dataset.testid === "cloud-drive"
					? rect(640, 20, 160, 32)
					: rect(0, 0, 0, 0);
			},
		);
		try {
			renderDrive(["w1", "w2", "not-on-this-page"]);
			const ropes = await screen.findByTestId("cloud-drive-ropes");
			await waitFor(() => {
				const drawn = [...ropes.querySelectorAll("path")].filter((p) =>
					p.getAttribute("d"),
				);
				expect(drawn).toHaveLength(2);
			});
			const [first] = ropes.querySelectorAll("path");
			// from under the Cloud Drive to the row's right end
			expect(first.getAttribute("d")).toMatch(/^M720,52 /);
			expect(first.getAttribute("d")).toMatch(/ L799,125$/);
		} finally {
			for (const row of rows) {
				row.remove();
			}
		}
	});
});
