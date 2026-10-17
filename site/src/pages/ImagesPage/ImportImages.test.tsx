import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { ImagesAPI, type Library } from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { IsoLibrary, ModelLibrary } from "./FileLibrary";
import { ImagesInUse } from "./ImagesInUse";
import { nameFrom } from "./ImportImageDialog";

const withQueries = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>{node}</MemoryRouter>
		</QueryClientProvider>,
	);

describe("nameFrom", () => {
	it("names an image after its repository or its archive", () => {
		expect(nameFrom("harbor.example.org/team/Data_Tool:1.2")).toBe("data-tool");
		expect(nameFrom("ghcr.io/user187x/coder-workspace@sha256:abc")).toBe(
			"coder-workspace",
		);
		expect(nameFrom("my-image.tar.gz")).toBe("my-image");
	});
});

describe("ImagesInUse", () => {
	afterEach(() => vi.restoreAllMocks());

	it("links the images here and offers to import the others", async () => {
		vi.spyOn(ImagesAPI, "inUse").mockResolvedValue({
			images: [
				{
					image: "localhost:5000/coder-images/tool:2",
					workspaces: ["alice/w1", "bob/w2"],
					templates: [],
					entry: "tool",
				},
				{
					image: "ghcr.io/x/dataflow:1.1.0",
					workspaces: [],
					templates: ["UBUNTU DATAFLOW"],
					entry: null,
				},
			],
		});
		const onImport = vi.fn();
		withQueries(<ImagesInUse canEdit onImport={onImport} />);
		expect(await screen.findByText("2 workspaces")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
			"href",
			"/images/tool",
		);
		fireEvent.click(screen.getByRole("button", { name: "Import" }));
		expect(onImport).toHaveBeenCalledWith({
			name: "dataflow",
			ref: "ghcr.io/x/dataflow:1.1.0",
		});
	});
});

describe("IsoLibrary", () => {
	afterEach(() => vi.restoreAllMocks());
	const library: Library = {
		enabled: true,
		canEdit: true,
		mountPath: "/home/coder/isos",
		maxBytes: 20 * 1024 ** 3,
		files: [
			{
				name: "ubuntu.iso",
				size: 6 * 1024 ** 3,
				modified: "2026-10-17T05:00:00Z",
			},
		],
		usedBytes: 6 * 1024 ** 3,
		imports: [
			{
				name: "debian.iso",
				url: "https://x/debian.iso",
				bytes: 50,
				total: 100,
				error: null,
				done: false,
				by: "admin",
				startedAt: 1,
			},
		],
	};

	it("shows the library where workspaces have it, and an import's progress", async () => {
		vi.spyOn(ImagesAPI, "library").mockResolvedValue(library);
		withQueries(<IsoLibrary />);
		expect(await screen.findByText("~/isos/ubuntu.iso")).toBeInTheDocument();
		expect(
			screen.getByRole("progressbar", { name: "Fetching debian.iso" }),
		).toHaveAttribute("aria-valuenow", "50");
		expect(
			screen.getByRole("button", { name: "Upload ISO" }),
		).toBeInTheDocument();
	});

	it("lets only editors change it, and deletes after a second click", async () => {
		vi.spyOn(ImagesAPI, "library").mockResolvedValue({
			...library,
			canEdit: false,
			imports: [],
		});
		withQueries(<IsoLibrary />);
		await screen.findByText("~/isos/ubuntu.iso");
		expect(screen.queryByRole("button", { name: "Upload ISO" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Delete ubuntu.iso" }),
		).toBeNull();
	});

	it("deletes after a second click", async () => {
		vi.spyOn(ImagesAPI, "library").mockResolvedValue({
			...library,
			imports: [],
		});
		const del = vi
			.spyOn(ImagesAPI, "deleteFromLibrary")
			.mockResolvedValue({ ok: true });
		withQueries(<IsoLibrary />);
		fireEvent.click(
			await screen.findByRole("button", { name: "Delete ubuntu.iso" }),
		);
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
		await waitFor(() => expect(del).toHaveBeenCalledWith("isos", "ubuntu.iso"));
	});
});

describe("ModelLibrary", () => {
	afterEach(() => vi.restoreAllMocks());

	it("lists the GGUF models where the AI workspaces have them, and uploads one", async () => {
		const get = vi.spyOn(ImagesAPI, "library").mockResolvedValue({
			enabled: true,
			canEdit: true,
			mountPath: "/home/coder/models",
			maxBytes: 100 * 1024 ** 3,
			files: [
				{
					name: "Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
					size: 4.7 * 1024 ** 3,
					modified: "2026-10-17T05:00:00Z",
				},
			],
			usedBytes: 4.7 * 1024 ** 3,
			imports: [],
		});
		const upload = vi
			.spyOn(ImagesAPI, "uploadToLibrary")
			.mockResolvedValue({ ok: true, name: "tiny.gguf", size: 1 });
		withQueries(<ModelLibrary />);
		expect(
			await screen.findByText("~/models/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf"),
		).toBeInTheDocument();
		expect(get).toHaveBeenCalledWith("models");
		expect(
			screen.getByRole("heading", { name: "Model library" }),
		).toBeInTheDocument();
		const file = new File(["GGUF"], "tiny.gguf");
		fireEvent.change(screen.getByTestId("models-file-input"), {
			target: { files: [file] },
		});
		await waitFor(() => expect(upload).toHaveBeenCalled());
		expect(upload.mock.calls[0].slice(0, 2)).toEqual(["models", file]);
	});
});
