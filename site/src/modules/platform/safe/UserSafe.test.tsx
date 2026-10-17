import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, PlatformError, type SafeSummary } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { UserSafe } from "./UserSafe";

const summary: SafeSummary = {
	enabled: true,
	mountPath: "/home/coder/safe",
	usedBytes: 1536 * 1024 * 1024,
	files: 3,
	quotaBytes: 10 * 1024 ** 3,
	maxUploadBytes: 5 * 1024 ** 3,
	volume: "ready",
};

const renderSafe = () =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<UserSafe />
		</QueryClientProvider>,
	);

describe("UserSafe", () => {
	beforeEach(() => {
		// no door swing to wait for in tests
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("shows nothing where the deployment has no safe", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getSafe")
			.mockRejectedValue(new PlatformError("not enabled", 404));
		renderSafe();
		await waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("user-safe")).toBeNull();
	});

	it("shows how full it is, closed", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		renderSafe();
		const tile = await screen.findByRole("button", { name: /your safe/i });
		expect(tile).toHaveAttribute("aria-expanded", "false");
		expect(tile).toHaveTextContent("1.5 GB of 10 GB");
	});

	it("opens onto its files, goes into a folder, and uploads there", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
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
		renderSafe();
		fireEvent.click(await screen.findByRole("button", { name: /your safe/i }));
		expect(
			await screen.findByRole("dialog", { name: "Your safe" }),
		).toBeInTheDocument();
		expect(await screen.findByText("notes.txt")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Download notes.txt" }),
		).toHaveAttribute("href", "/__coder-ui/api/safe/download?path=notes.txt");
		expect(
			screen.getByText("In each of your workspaces at ~/safe"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "docs" }));
		await waitFor(() => expect(list).toHaveBeenCalledWith("docs"));
		expect(
			await screen.findByText("This folder is empty."),
		).toBeInTheDocument();
		const file = new File(["hello"], "a b.txt", { type: "text/plain" });
		fireEvent.change(screen.getByTestId("safe-file-input"), {
			target: { files: [file] },
		});
		await waitFor(() => expect(upload).toHaveBeenCalled());
		expect(upload.mock.calls[0][0]).toBe("docs/a b.txt");
		expect(await screen.findByText("Done")).toBeInTheDocument();
	});

	it("asks once more before deleting", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue({
			path: "",
			folders: [],
			files: [{ name: "old.log", size: 1, modified: "2026-10-17T05:00:00Z" }],
		});
		const del = vi
			.spyOn(PlatformAPI, "deleteFromSafe")
			.mockResolvedValue({ ok: true, removed: 1 });
		renderSafe();
		fireEvent.click(await screen.findByRole("button", { name: /your safe/i }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Delete old.log" }),
		);
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
		await waitFor(() => expect(del).toHaveBeenCalledWith("old.log"));
	});
});
