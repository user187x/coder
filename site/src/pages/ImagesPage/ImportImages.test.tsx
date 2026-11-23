import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { ImagesAPI } from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { DockerImageLibrary } from "./DockerImageLibrary";
import { ImagesInUse, ImagesOnNodes } from "./ImagesInUse";
import { ImagesSettingsDialog } from "./ImagesSettingsDialog";
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
		expect(nameFrom("docker.io/mrshll187/coder-workspace@sha256:abc")).toBe(
			"coder-workspace",
		);
		expect(nameFrom("my-image.tar.gz")).toBe("my-image");
	});
});

describe("ImagesInUse", () => {
	afterEach(() => vi.restoreAllMocks());

	it("links existing entries and offers import and export actions", async () => {
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
					templates: ["DATAFLOW"],
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
		expect(
			screen.getByRole("link", { name: "Export ghcr.io/x/dataflow:1.1.0" }),
		).toHaveAttribute(
			"href",
			"/__coder-ui/api/images/download?ref=ghcr.io%2Fx%2Fdataflow%3A1.1.0",
		);
		fireEvent.click(screen.getByRole("button", { name: "Import" }));
		expect(onImport).toHaveBeenCalledWith({
			name: "dataflow",
			ref: "ghcr.io/x/dataflow:1.1.0",
		});
	});
});

describe("Trivy settings", () => {
	afterEach(() => vi.restoreAllMocks());

	it("installs the configured scanner and requests a selected upgrade", async () => {
		const user = userEvent.setup();
		vi.spyOn(ImagesAPI, "settings").mockResolvedValue({
			aptSources: "",
			defaultAptSources: "",
			index: { sources: 0, packages: 0, loadedAt: null, errors: [] },
			s3: {},
			canChange: true,
			hardening: {},
		});
		vi.spyOn(ImagesAPI, "securityData").mockRejectedValue(
			new Error("No security data"),
		);
		const initial = {
			enabled: false,
			requestedVersion: "0.76.0",
			activeVersion: null,
			installing: false,
			error: "",
			updatingDefinitions: false,
			definitionError: "",
			sources: {
				releaseUrl: "https://mirror.example/releases",
				dbRepository: "mirror.example/trivy/db:2",
				javaDbRepository: "mirror.example/trivy/java-db:1",
			},
		};
		vi.spyOn(ImagesAPI, "trivyScanner").mockResolvedValue(initial);
		const configure = vi
			.spyOn(ImagesAPI, "configureTrivyScanner")
			.mockResolvedValue({
				...initial,
				enabled: true,
				activeVersion: "0.76.0",
			});
		const refresh = vi
			.spyOn(ImagesAPI, "refreshTrivyDefinitions")
			.mockResolvedValue({
				...initial,
				enabled: true,
				activeVersion: "0.76.0",
			});
		withQueries(<ImagesSettingsDialog onClose={vi.fn()} />);
		await user.click(
			await screen.findByRole("switch", { name: "Enable Trivy Scanner" }),
		);
		expect(configure).toHaveBeenCalledWith(true, "0.76.0");

		const updateDefinitions = screen.getByRole("button", {
			name: "Update scan definitions",
		});
		await waitFor(() => expect(updateDefinitions).toBeEnabled());
		await user.click(updateDefinitions);
		expect(refresh).toHaveBeenCalledOnce();

		const version = screen.getByRole("textbox", {
			name: "Trivy release version",
		});
		await user.clear(version);
		await user.type(version, "0.77.0");
		await user.click(screen.getByRole("button", { name: "Install version" }));
		expect(configure).toHaveBeenLastCalledWith(true, "0.77.0");

		await user.click(screen.getByText("Download sources"));
		const dbRepository = screen.getByRole("textbox", {
			name: "Vulnerability database repository",
		});
		await user.clear(dbRepository);
		await user.type(dbRepository, "registry.internal/security/trivy-db:2");
		await user.click(
			screen.getByRole("button", { name: "Save download sources" }),
		);
		expect(configure).toHaveBeenLastCalledWith(true, "0.76.0", {
			...initial.sources,
			dbRepository: "registry.internal/security/trivy-db:2",
		});
	});
});

describe("Docker Image Library", () => {
	afterEach(() => vi.restoreAllMocks());

	it("uploads the selected archive with its original reference and refreshes the library", async () => {
		const user = userEvent.setup();
		const archive = new File(["archive"], "pgbouncer.tar", {
			type: "application/x-tar",
		});
		const ref = "ghcr.io/cloudnative-pg/pgbouncer:1.25.1";
		const list = vi
			.spyOn(ImagesAPI, "dependencies")
			.mockResolvedValue({ images: [], upload: null });
		const upload = vi
			.spyOn(ImagesAPI, "uploadDependency")
			.mockResolvedValue({ ok: true });
		withQueries(<DockerImageLibrary canUpload />);
		await user.click(screen.getByRole("button", { name: "Upload image" }));
		await user.type(
			screen.getByRole("textbox", { name: "Image reference in the archive" }),
			ref,
		);
		await user.upload(screen.getByLabelText("Image archive"), archive);
		await user.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() =>
			expect(upload).toHaveBeenCalledWith(ref, archive, expect.any(Function)),
		);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
	});
});

describe("ImagesOnNodes", () => {
	afterEach(() => vi.restoreAllMocks());

	it("cleans up a digest-only image by its digest while showing the tag its pods pin", async () => {
		const digest = `docker.io/coturn/coturn@sha256:${"b".repeat(64)}`;
		vi.spyOn(ImagesAPI, "onNodes").mockResolvedValue({
			images: [
				{
					image: digest,
					tag: "docker.io/coturn/coturn:4.18.0-r0",
					names: [],
					sizeBytes: 51_000_000,
					nodes: ["n1"],
					running: false,
					entry: null,
					purgeBlocked: "",
				},
			],
		});
		const preview = vi
			.spyOn(ImagesAPI, "previewNodeImageCleanup")
			.mockReturnValue(new Promise(() => {}));
		withQueries(<ImagesOnNodes canEdit />);
		fireEvent.click(
			await screen.findByRole("checkbox", {
				name: "Select docker.io/coturn/coturn:4.18.0-r0 for cleanup",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Review cleanup (1)" }));
		await waitFor(() => expect(preview).toHaveBeenCalledWith([digest]));
	});
});
