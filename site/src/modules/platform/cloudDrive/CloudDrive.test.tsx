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
	quota: { gib: 10, chartGib: 10, custom: false, min: 1, max: 10240 },
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
			screen.getByRole("button", { name: "Download notes.txt" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("In each of your workspaces at ~/cloud-drive"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "docs" }));
		await waitFor(() => expect(list).toHaveBeenCalledWith("docs", undefined));
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
		await waitFor(() => expect(del).toHaveBeenCalledWith("old.log", undefined));
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

	it("downloads a file with its progress", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue({
			path: "",
			folders: [],
			files: [{ name: "big.bin", size: 8, modified: "2026-10-17T05:00:00Z" }],
		});
		let release: () => void = () => {};
		const second = new Promise<void>((r) => {
			release = r;
		});
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				controller.enqueue(new Uint8Array(4));
				await second;
				controller.enqueue(new Uint8Array(4));
				controller.close();
			},
		});
		const fetchSpy = vi
			.spyOn(window, "fetch")
			.mockResolvedValue(
				new Response(body, { headers: { "Content-Length": "8" } }),
			);
		URL.createObjectURL = vi.fn(() => "blob:big");
		URL.revokeObjectURL = vi.fn();
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		fireEvent.click(
			await screen.findByRole("button", { name: "Download big.bin" }),
		);
		const bar = await screen.findByRole("progressbar", {
			name: "Downloading big.bin",
		});
		await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
		expect(fetchSpy.mock.calls[0][0]).toBe(
			"/__coder-ui/api/safe/download?path=big.bin",
		);
		release();
		await waitFor(() =>
			expect(screen.getByTestId("cloud-drive-download")).toHaveTextContent(
				"Done",
			),
		);
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it("lets an admin set every account's capacity", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
			settings({ canEdit: true }),
		);
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue(emptyListing);
		const save = vi
			.spyOn(PlatformAPI, "saveCloudDriveQuota")
			.mockResolvedValue({
				gib: 250,
				chartGib: 10,
				custom: true,
				min: 1,
				max: 10240,
			});
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
		const capacity = await screen.findByTestId("cloud-drive-capacity");
		expect(within(capacity).getByRole("slider")).toBeInTheDocument();
		fireEvent.change(
			within(capacity).getByLabelText("Capacity per account, in GiB"),
			{ target: { value: "250" } },
		);
		fireEvent.click(
			within(capacity).getByRole("button", { name: "Save capacity" }),
		);
		await waitFor(() => expect(save).toHaveBeenCalledWith({ quotaGiB: 250 }));
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

	/** Two of the account's rows (w1, w2) under a Cloud Drive at (640, 20), 160 wide; the drawing at (0, 0). */
	const withRows = async (
		disconnected: string[],
		run: (ropes: HTMLElement) => Promise<void>,
	) => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
			disconnected,
			older: [],
		});
		const rows = ["w1", "w2"].map((id, i) => {
			const row = document.createElement("div");
			row.dataset.testid = `workspace-${id}`;
			row.getBoundingClientRect = () => rect(0, 100 + i * 60, 800, 50);
			document.body.appendChild(row);
			return row;
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				return this.dataset.testid === "cloud-drive-container"
					? rect(640, 20, 160, 32)
					: rect(0, 0, 0, 0);
			},
		);
		try {
			renderDrive(["w1", "w2", "not-on-this-page"]);
			await run(await screen.findByTestId("cloud-drive-ropes"));
		} finally {
			for (const row of rows) {
				row.remove();
			}
		}
	};

	const cables = (ropes: HTMLElement) =>
		[...ropes.querySelectorAll<SVGGElement>("g[data-wire]")].filter(
			(g) => g.getAttribute("visibility") === "visible",
		);

	it("cables each of the account's connected workspace rows to it", async () => {
		await withRows(["w2"], async (ropes) => {
			await waitFor(() => expect(cables(ropes)).toHaveLength(1));
			const [cable] = cables(ropes);
			expect(cable.dataset.workspace).toBe("w1");
			// from the socket on the Cloud Drive's right side, looping round into the plug at the row's right end
			const d = cable.querySelector("path.cd-cable")?.getAttribute("d");
			expect(d).toMatch(/^M807,36 C/);
			expect(d).toMatch(/ 815,125$/);
			// the plug in the row's edge, its prongs pointing in (left)
			expect(cable.querySelector(".cd-plug")?.getAttribute("transform")).toBe(
				"translate(815,125) rotate(180)",
			);
		});
	});

	it("disconnects a workspace whose plug is dragged away, and connects one a new cable is dragged onto", async () => {
		const off = new Set(["w2"]);
		const save = vi
			.spyOn(PlatformAPI, "setCloudDriveConnection")
			.mockImplementation(async (workspaceId, connected) => {
				if (connected) {
					off.delete(workspaceId);
				} else {
					off.add(workspaceId);
				}
				return {
					disconnected: [...off],
					older: [],
					workspace: workspaceId,
					connected,
					applied: true,
				};
			});
		await withRows(["w2"], async (ropes) => {
			await waitFor(() => expect(cables(ropes)).toHaveLength(1));
			// w1's plug, dragged off to the right and let go
			const plug = cables(ropes)[0].querySelector('[data-grab="plug"]');
			fireEvent.pointerDown(plug as Element, {
				button: 0,
				pointerId: 1,
				clientX: 815,
				clientY: 125,
			});
			fireEvent.pointerMove(window, {
				pointerId: 1,
				clientX: 990,
				clientY: 40,
			});
			fireEvent.pointerUp(window, { pointerId: 1, clientX: 990, clientY: 40 });
			await waitFor(() => expect(save).toHaveBeenCalledWith("w1", false));
			await waitFor(() => expect(cables(ropes)).toHaveLength(0));

			// a new cable out of the socket, onto w2's row (connected already: nothing; then free)
			const socket = ropes.querySelector('[data-grab="socket"]');
			fireEvent.pointerDown(socket as Element, {
				button: 0,
				pointerId: 2,
				clientX: 803,
				clientY: 36,
			});
			fireEvent.pointerMove(window, {
				pointerId: 2,
				clientX: 840,
				clientY: 185,
			});
			expect(
				document
					.querySelector('[data-testid="workspace-w2"]')
					?.getAttribute("data-cloud-drive-drop"),
			).toBe("on");
			fireEvent.pointerUp(window, { pointerId: 2, clientX: 840, clientY: 185 });
			await waitFor(() => expect(save).toHaveBeenCalledWith("w2", true));
			await waitFor(() => {
				const [cable] = cables(ropes);
				expect(cable?.dataset.workspace).toBe("w2");
				expect(cable?.dataset.phase).toBe("plugged");
			});
			expect(
				document
					.querySelector('[data-testid="workspace-w2"]')
					?.hasAttribute("data-cloud-drive-drop"),
			).toBe(false);
		});
	});

	it("Refresh spins while it reads the drive, then shows a check", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		const list = vi
			.spyOn(PlatformAPI, "listSafe")
			.mockResolvedValue(emptyListing);
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		const button = await screen.findByTestId("cloud-drive-refresh");
		const before = list.mock.calls.length;
		fireEvent.click(button);
		expect(button.dataset.state).toBe("busy");
		expect(button).toHaveAttribute("aria-busy", "true");
		expect(button.querySelector("svg")?.getAttribute("class")).toContain(
			"animate-spin",
		);
		await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
		await waitFor(
			() =>
				expect(screen.getByTestId("cloud-drive-refresh").dataset.state).toBe(
					"done",
				),
			{ timeout: 3000 },
		);
		expect(screen.getByTestId("cloud-drive-refresh")).toHaveAccessibleName(
			"Refreshed",
		);
	});

	it("opens a Cloud Drive shared with the user at once, read only where it is", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(settings());
		const share = (
			owner: string,
			ownerName: string,
			access: "read" | "write",
		) => ({
			id: `s-${owner}`,
			from: "me-id",
			fromName: "me",
			owner,
			ownerName,
			access,
			asked: access,
			state: "active" as const,
			askedAt: 1,
			kind: "drive" as const,
			path: "",
			by: "request" as const,
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue({
			settings: {
				enabled: true,
				adminApproval: true,
				updatedBy: null,
				updatedAt: null,
			},
			admin: false,
			me: "me-id",
			asked: [
				share("greg-id", "greg", "read"),
				share("ann-id", "ann", "write"),
				{ ...share("bob-id", "bob", "read"), state: "ended" },
			],
			ofMine: [],
		});
		const list = vi
			.spyOn(PlatformAPI, "listSafe")
			.mockImplementation(async (path, drive) => ({
				path,
				// in a shared drive, what the user may do there
				access: drive ? (drive === "ann-id" ? "write" : "read") : undefined,
				folders: [],
				files: [
					{
						name: drive ? `${drive}.txt` : "mine.txt",
						size: 10,
						modified: "2026-10-18T05:00:00Z",
					},
				],
			}));
		const upload = vi
			.spyOn(PlatformAPI, "uploadToSafe")
			.mockImplementation(async (path, file) => ({
				ok: true,
				path,
				size: file.size,
			}));
		renderDrive();
		fireEvent.click(await screen.findByTestId("cloud-drive"));
		expect(await screen.findByText("mine.txt")).toBeInTheDocument();
		const drives = await screen.findByTestId("cloud-drive-drives");
		// the active shares only, by owner
		expect(
			within(drives)
				.getAllByRole("tab")
				.map((t) => t.textContent),
		).toEqual(["Mine", "ann's (read and write)", "greg's (read only)"]);

		fireEvent.click(within(drives).getByText("greg's (read only)"));
		expect(await screen.findByText("greg-id.txt")).toBeInTheDocument();
		expect(list).toHaveBeenLastCalledWith("", "greg-id");
		expect(screen.getByText("greg's Cloud Drive")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
		expect(screen.getByTestId("cloud-drive-shared-footer")).toHaveTextContent(
			"Shared with you by greg: their entire Cloud Drive (read only)",
		);

		fireEvent.click(within(drives).getByText("ann's (read and write)"));
		expect(await screen.findByText("ann-id.txt")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Upload/ })).toBeInTheDocument();
		fireEvent.change(screen.getByTestId("cloud-drive-file-input"), {
			target: { files: [new File(["x"], "x.txt")] },
		});
		await waitFor(() => expect(upload).toHaveBeenCalled());
		expect(upload.mock.calls[0][0]).toBe("x.txt");
		expect(upload.mock.calls[0][3]).toBe("ann-id");

		fireEvent.click(within(drives).getByText("Mine"));
		expect(await screen.findByText("mine.txt")).toBeInTheDocument();
	});
});
