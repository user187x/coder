import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import {
	type ImageContents,
	type ImageContentsCatalog,
	type ImageListItem,
	ImagesAPI,
} from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import {
	CoderForkImages,
	ImageContentsTree,
	ourImage,
} from "./CoderForkImages";
import ImagesPage from "./ImagesPage";

const workspace: ImageContents = {
	ref: "ghcr.io/user187x/coder-workspace:1.9.3",
	repository: "coder-workspace",
	digest: `sha256:${"8".repeat(64)}`,
	imageId: `sha256:${"8".repeat(64)}`,
	section: "workspaces",
	description: "The workspace image",
	source: {
		folder: "development/workspace-image",
		build: "development/tools/build-workspace-image.sh",
	},
	created: "2026-10-18T05:00:00Z",
	size: 6 * 1024 ** 3,
	platform: "linux/amd64",
	config: {
		user: "coder",
		entrypoint: null,
		cmd: ["/bin/bash"],
		workdir: "/home/coder",
		ports: [],
		env: ["PATH=/usr/bin", "LANG=en_US.UTF-8"],
		labels: { "org.opencontainers.image.version": "24.04" },
	},
	layers: 3,
	steps: [
		{ step: "ADD file:abc in /", size: "78MB", comment: "" },
		{ step: "RUN apt-get install -y terminator", size: "1.2GB", comment: "" },
	],
	programs: [],
	addons: {
		base: "codercom/enterprise-base:ubuntu",
		builtAt: "2026-10-18T05:00:00Z",
		software: [
			{
				name: "code-server",
				what: "VS Code in the browser",
				group: "Apps",
				version: "4.141.0",
			},
		],
		packages: {
			added: [{ name: "terminator", version: "2.1.4" }],
			dependencies: 800,
			upgraded: 3,
			installed: 1300,
		},
		python: { environment: null, packages: [] },
	},
	packages: {
		os: {
			manager: "dpkg",
			count: 3,
			items: [
				["bash", "5.2.21"],
				["libssl3t64", "3.0.13"],
				["terminator", "2.1.4"],
			],
		},
		python: [
			{
				env: "/usr",
				count: 2,
				items: [
					["numpy", "2.4.0"],
					["pip", "24.0"],
				],
			},
		],
	},
};

const registry: ImageContents = {
	...workspace,
	ref: "ghcr.io/user187x/coder-registry:3.1.2-1",
	repository: "coder-registry",
	section: "platform",
	description: "The image registry",
	addons: null,
	programs: [
		{
			name: "Docker registry",
			what: "Where built and imported images are kept",
			version: "3.1.2",
		},
	],
	packages: { os: null, python: [] },
};

const catalog: ImageContentsCatalog = {
	images: { [workspace.ref]: workspace, [registry.ref]: registry },
};

const tracked = (tag: string): ImageListItem => ({
	id: "workspace",
	name: "workspace",
	description: "The image the workspace template runs",
	createdBy: "platform",
	createdAt: "2026-10-18T05:00:00Z",
	updatedBy: null,
	updatedAt: "2026-10-18T05:00:00Z",
	version: 0,
	status: "ready",
	ref: `localhost:5000/coder-images/base/coder-workspace:${tag}`,
	digest: null,
	size: 1234,
	builtAt: "2026-10-18T05:00:00Z",
	builtBy: "platform",
	pullRef: `ghcr.io/user187x/coder-workspace:${tag}`,
	s3: {},
	base: { kind: "workspace" },
	counts: { packages: 0, debs: 0, installations: 0, remove: 0 },
	desktop: "keep",
	summary: null,
	tracked: {
		image: `ghcr.io/user187x/coder-workspace:${tag}`,
		ref: `localhost:5000/coder-images/base/coder-workspace:${tag}`,
		template: "UBUNTU",
	},
});

const withQueries = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<MemoryRouter>{node}</MemoryRouter>
		</QueryClientProvider>,
	);

describe("ourImage", () => {
	it("knows the Coder fork's images, and their other versions", () => {
		expect(ourImage(catalog, workspace.ref)).toEqual({
			contents: workspace,
			exact: true,
		});
		expect(ourImage(catalog, "ghcr.io/user187x/coder-workspace:1.9.2")).toEqual(
			{ contents: workspace, exact: false },
		);
		expect(ourImage(catalog, "docker.io/library/postgres:17")).toBeUndefined();
		expect(
			ourImage(catalog, "ghcr.io/user187x/coder-unknown:1"),
		).toBeUndefined();
		expect(ourImage(undefined, workspace.ref)).toBeUndefined();
		expect(ourImage(catalog, null)).toBeUndefined();
	});
});

describe("ImageContentsTree", () => {
	it("opens every part of what an image holds, and finds anything in it", () => {
		withQueries(
			<ImageContentsTree
				ours={{ contents: workspace, exact: false }}
				asked="ghcr.io/user187x/coder-workspace:1.9.2"
			/>,
		);
		expect(screen.getByTestId("image-contents")).toHaveTextContent(
			"Described as coder-workspace:1.9.3, the version the platform pins: this one is coder-workspace:1.9.2",
		);
		// the overview is open, the packages closed until asked
		expect(screen.getByTestId("contents-overview")).toHaveTextContent(
			"development/tools/build-workspace-image.sh",
		);
		const os = screen.getByTestId("contents-os");
		expect(os).toHaveTextContent("OS packages (dpkg)3");
		expect(os).not.toHaveTextContent("libssl3t64");
		fireEvent.click(within(os).getByRole("button", { name: /OS packages/ }));
		expect(screen.getByTestId("contents-os")).toHaveTextContent(
			"libssl3t64 3.0.13",
		);
		// the filter: only what matches, in its branches, opened, counted "of all"
		fireEvent.change(screen.getByLabelText("Find in what it holds"), {
			target: { value: "terminator" },
		});
		expect(screen.getByTestId("contents-os")).toHaveTextContent(
			"OS packages (dpkg)1 of 3",
		);
		expect(screen.getByTestId("contents-os")).not.toHaveTextContent("bash");
		expect(screen.getByTestId("contents-addons-apt")).toHaveTextContent(
			"terminator 2.1.4",
		);
		expect(screen.getByTestId("contents-steps")).toHaveTextContent(
			"RUN apt-get install -y terminator",
		);
		expect(screen.queryByTestId("contents-python")).toBeNull();
		// a branch opened by the filter closes by hand
		fireEvent.click(
			within(screen.getByTestId("contents-steps")).getByRole("button", {
				name: /Build steps/,
			}),
		);
		expect(screen.getByTestId("contents-steps")).not.toHaveTextContent(
			"RUN apt-get",
		);
		fireEvent.change(screen.getByLabelText("Find in what it holds"), {
			target: { value: "nothing-like-it" },
		});
		expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
	});
});

describe("Coder fork images", () => {
	afterEach(() => vi.restoreAllMocks());

	it("lists every image of ours, each opening what it holds", async () => {
		vi.spyOn(ImagesAPI, "contents").mockResolvedValue(catalog);
		withQueries(<CoderForkImages />);
		const row = await screen.findByTestId("coder-fork-coder-registry");
		expect(row).toHaveTextContent("coder-registryCoder fork");
		expect(row).toHaveTextContent("1 program");
		expect(screen.getByTestId("coder-fork-coder-workspace")).toHaveTextContent(
			"1 add-ons · 3 OS packages · 2 Python packages",
		);
		expect(screen.queryByTestId("image-contents")).toBeNull();
		fireEvent.click(row);
		expect(await screen.findByTestId("image-contents")).toHaveTextContent(
			"Docker registry3.1.2",
		);
	});
});

describe("The Images table", () => {
	afterEach(() => vi.restoreAllMocks());

	const page = (images: ImageListItem[]) => {
		vi.spyOn(ImagesAPI, "list").mockResolvedValue({
			images,
			canEdit: true,
			pullPrefix: "localhost:5000/coder-images/",
			baseImage: "ghcr.io/user187x/coder-workspace:1.9.2",
		});
		vi.spyOn(ImagesAPI, "contents").mockResolvedValue(catalog);
		vi.spyOn(ImagesAPI, "inUse").mockResolvedValue({ images: [] });
		vi.spyOn(ImagesAPI, "onNodes").mockResolvedValue({ images: [] });
		return vi.spyOn(ImagesAPI, "remove").mockResolvedValue({ ok: true });
	};

	it("tags the workspace image as the Coder fork's, opens what it holds, and deletes its entry", async () => {
		const remove = page([tracked("1.9.2")]);
		withQueries(<ImagesPage />);
		const row = await screen.findByTestId("image-workspace");
		await waitFor(() =>
			expect(within(row).getByTestId("coder-fork")).toHaveTextContent(
				"Coder fork",
			),
		);
		fireEvent.click(within(row).getByTestId("contents-toggle"));
		expect(await screen.findByTestId("image-contents")).toHaveTextContent(
			"this one is coder-workspace:1.9.2",
		);
		// beside Download: Delete, confirmed first, saying what goes and what stays
		fireEvent.click(within(row).getByTestId("image-delete"));
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveTextContent(
			"Only this entry and its security report go: the workspace template keeps running ghcr.io/user187x/coder-workspace:1.9.2",
		);
		expect(remove).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(remove).toHaveBeenCalledWith("workspace"));
	});

	it("offers Delete for every image, beside Download", async () => {
		const built: ImageListItem = {
			...tracked("1.9.2"),
			id: "tool",
			name: "tool",
			tracked: null,
			pullRef: "localhost:5000/coder-images/tool:1",
			version: 1,
		};
		const scanned: ImageListItem = {
			...built,
			id: "scan-postgres",
			name: "scan-postgres",
			pullRef: null,
			scanned: { image: "docker.io/library/postgres:17" },
		};
		page([built, scanned]);
		withQueries(<ImagesPage />);
		const tool = await screen.findByTestId("image-tool");
		expect(
			within(tool).getByRole("link", { name: "Download tool" }),
		).toBeInTheDocument();
		expect(within(tool).getByTestId("image-delete")).toBeEnabled();
		expect(within(tool).queryByTestId("coder-fork")).toBeNull();
		const scan = screen.getByTestId("image-scan-postgres");
		fireEvent.click(within(scan).getByTestId("image-delete"));
		expect(await screen.findByRole("dialog")).toHaveTextContent(
			"Only this scan goes: docker.io/library/postgres:17 itself is not touched.",
		);
	});
});
