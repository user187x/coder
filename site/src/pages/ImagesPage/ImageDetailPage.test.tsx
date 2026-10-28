import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import {
	type BuildSummary,
	type ImageDetail,
	type ImageListItem,
	ImagesAPI,
} from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import ImageDetailPage from "./ImageDetailPage";

const scan = (id: number, over: Partial<BuildSummary> = {}): BuildSummary => ({
	id,
	version: 0,
	status: "ready",
	stage: "done",
	progress: 1,
	message: "Rescanned: grade B",
	startedAt: "2026-10-20T19:02:40Z",
	finishedAt: "2026-10-20T19:03:22Z",
	by: "platform",
	error: null,
	scanOnly: true,
	...over,
});

const WORKSPACE_IMAGE = "docker.io/user187x/coder-workspace:1.9.4";

/** The workspace template's image (tracked): every row of its table is a scan. */
const tracked = (over: Partial<ImageDetail> = {}): ImageDetail => ({
	id: "coder-workspace",
	name: "coder-workspace",
	description: "",
	createdBy: "platform",
	createdAt: "2026-10-20T05:00:00Z",
	updatedBy: null,
	updatedAt: "2026-10-20T05:00:00Z",
	version: 0,
	status: "ready",
	ref: "coder-image-registry.coder.svc:5000/coder-images/base/coder-workspace:1.9.4",
	digest: null,
	size: null,
	builtAt: "2026-10-20T05:00:00Z",
	builtBy: "platform",
	pullRef: WORKSPACE_IMAGE,
	s3: {},
	base: { kind: "workspace" },
	counts: { packages: 0, debs: 0, installations: 0, remove: 0 },
	desktop: "keep",
	summary: null,
	tracked: {
		image: WORKSPACE_IMAGE,
		ref: "coder-image-registry.coder.svc:5000/coder-images/base/coder-workspace:1.9.4",
		template: "DEFAULT",
	},
	spec: {
		base: { kind: "workspace" },
		packages: [],
		debs: [],
		installations: [],
		remove: [],
		hardening: { script: "" },
		desktop: "keep",
		fips: false,
		config: { aliases: "", functions: "", profile: "", dotfiles: [] },
	},
	report: null,
	builds: [scan(2), scan(1)],
	activeBuild: null,
	canEdit: true,
	...over,
});

/** The page on an image the service keeps as `current` (a delete that goes through takes the row out of it). */
const renderPage = (image: ImageDetail) => {
	let current = image;
	vi.spyOn(ImagesAPI, "get").mockImplementation(async () => ({
		image: current,
	}));
	vi.spyOn(ImagesAPI, "list").mockResolvedValue({
		images: [] as ImageListItem[],
		canEdit: image.canEdit,
		pullPrefix: "localhost:5000",
		baseImage: "coder-workspace",
	});
	vi.spyOn(ImagesAPI, "contents").mockResolvedValue({ images: {} });
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={[`/images/${image.id}`]}>
				<Routes>
					<Route path="/images/:image" element={<ImageDetailPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return {
		gone: (id: number) => {
			current = {
				...current,
				builds: current.builds.filter((b) => b.id !== id),
			};
		},
	};
};

describe("ImageDetailPage: deleting a scan", () => {
	afterEach(() => vi.restoreAllMocks());

	it("asks first, takes the row out at once and keeps it out", async () => {
		const page = renderPage(tracked());
		const del = vi
			.spyOn(ImagesAPI, "deleteScan")
			.mockImplementation(async (_, build) => {
				page.gone(build);
				return { ok: true };
			});
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", {
				name: "Delete the scan #2 of coder-workspace",
			}),
		);
		expect(del).not.toHaveBeenCalled();
		const dialog = screen.getByTestId("dialog");
		expect(dialog).toHaveTextContent("Delete scan #2");
		expect(dialog).toHaveTextContent(
			`${WORKSPACE_IMAGE} itself is not touched`,
		);
		await user.click(within(dialog).getByRole("button", { name: "Delete" }));
		expect(del).toHaveBeenCalledWith("coder-workspace", 2);
		await waitFor(() =>
			expect(screen.queryByTestId("image-build-2")).toBeNull(),
		);
		expect(screen.getByTestId("image-build-1")).toBeInTheDocument();
		// still out once the image is read again
		await waitFor(() => expect(ImagesAPI.get).toHaveBeenCalledTimes(2));
		expect(screen.queryByTestId("image-build-2")).toBeNull();
	});

	it("puts the row back when the service refuses", async () => {
		renderPage(tracked());
		let refuse: (e: Error) => void = () => {};
		vi.spyOn(ImagesAPI, "deleteScan").mockImplementation(
			() =>
				new Promise((_, reject) => {
					refuse = reject;
				}),
		);
		const user = userEvent.setup();
		await user.click(await screen.findByTestId("scan-delete-1"));
		await user.click(
			within(screen.getByTestId("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);
		// gone while the service answers...
		await waitFor(() =>
			expect(screen.queryByTestId("image-build-1")).toBeNull(),
		);
		refuse(new Error("This scan is still running"));
		// ...and back when it says no
		expect(await screen.findByTestId("image-build-1")).toBeInTheDocument();
	});

	it("offers it only on finished scans, to editors", async () => {
		renderPage(
			tracked({
				id: "tool",
				name: "tool",
				tracked: null,
				version: 2,
				builds: [
					scan(3, { status: "scanning", finishedAt: null }),
					scan(2, { version: 2 }),
					// a build: its version's record, which goes with the image
					scan(1, { version: 2, message: "Ready", scanOnly: false }),
				],
			}),
		);
		expect(await screen.findByTestId("scan-delete-3")).toBeDisabled();
		expect(screen.getByTestId("scan-delete-2")).toBeEnabled();
		expect(screen.getByTestId("image-build-1")).toBeInTheDocument();
		expect(screen.queryByTestId("scan-delete-1")).toBeNull();
	});

	it("shows no trash can to those who cannot change images", async () => {
		renderPage(tracked({ canEdit: false }));
		expect(await screen.findByTestId("image-build-2")).toBeInTheDocument();
		expect(screen.queryByTestId("scan-delete-2")).toBeNull();
		expect(screen.queryByTestId("scan-delete-1")).toBeNull();
	});
});
