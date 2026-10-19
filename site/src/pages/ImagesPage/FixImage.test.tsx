import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import {
	type ImageDetail,
	type ImageListItem,
	ImagesAPI,
	type ImageVulnerability,
} from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import FixImagePage from "./FixImagePage";
import {
	classify,
	fixScript,
	gradeAfter,
	hunks,
	pickFixed,
	pipFor,
} from "./fixPlan";
import ImagesPage from "./ImagesPage";

const vuln = (over: Partial<ImageVulnerability>): ImageVulnerability => ({
	id: "CVE-2026-0001",
	pkg: "openssl",
	installed: "3.0.2-0ubuntu1.12",
	fixed: "3.0.2-0ubuntu1.18",
	severity: "CRITICAL",
	title: "Heap overflow in TLS handshake",
	target: "localhost:5000/coder-images/tool:2 (ubuntu 24.04)",
	class: "os-pkgs",
	type: "ubuntu",
	...over,
});

const FINDINGS = [
	vuln({}),
	vuln({ id: "CVE-2026-1180", pkg: "glibc", severity: "HIGH" }),
	vuln({
		id: "CVE-2025-9120",
		pkg: "requests",
		installed: "2.28.1",
		fixed: "2.32.3, 2.28.9",
		severity: "HIGH",
		target:
			"opt/airflow/lib/python3.14/site-packages/requests-2.28.1.dist-info/METADATA",
		class: "lang-pkgs",
		type: "python-pkg",
	}),
	vuln({
		id: "CVE-2026-5003",
		pkg: "node",
		installed: "20.11.0",
		fixed: "",
		severity: "CRITICAL",
		target: "usr/lib/node",
		class: "lang-pkgs",
		type: "node-pkg",
	}),
	vuln({
		id: "CVE-2026-7000",
		pkg: "lodash",
		installed: "4.17.20",
		fixed: "4.17.21",
		severity: "HIGH",
		target: "opt/app/node_modules/lodash/package.json",
		class: "lang-pkgs",
		type: "node-pkg",
	}),
];

const detail = (over: Partial<ImageDetail> = {}): ImageDetail =>
	({
		id: "tool",
		name: "tool",
		description: "",
		createdBy: "admin",
		createdAt: "2026-10-18T10:00:00Z",
		updatedBy: null,
		updatedAt: "2026-10-18T10:00:00Z",
		version: 2,
		status: "ready",
		ref: "localhost:5000/coder-images/tool:2",
		digest: null,
		size: 1,
		builtAt: "2026-10-18T10:00:00Z",
		builtBy: "admin",
		pullRef: "localhost:5000/coder-images/tool:2",
		s3: { enabled: false },
		base: { kind: "workspace" },
		counts: { packages: 1, debs: 0, installations: 0, remove: 0 },
		desktop: "keep",
		summary: null,
		canEdit: true,
		activeBuild: null,
		builds: [],
		spec: {
			base: { kind: "workspace" },
			packages: ["openssl"],
			debs: [],
			installations: [],
			remove: [],
			hardening: { script: "" },
			desktop: "keep",
			fips: false,
			config: { aliases: "", functions: "", profile: "", dotfiles: [] },
		},
		report: {
			ref: "localhost:5000/coder-images/tool:2",
			scannedAt: "2026-10-19T03:00:00Z",
			grade: "F",
			dbUpdatedAt: null,
			vulnerabilities: {
				counts: { CRITICAL: 2, HIGH: 3 },
				total: 5,
				fixable: 4,
				top: FINDINGS,
			},
			secrets: [],
			checks: [],
			fips: { status: "not-ready", note: "", checks: [] },
		},
		...over,
	}) as unknown as ImageDetail;

describe("the fix plan", () => {
	it("groups findings by how they get fixed", () => {
		const f = classify(detail());
		expect(f.map((x) => [x.pkg, x.group, x.source, x.applicable])).toEqual([
			["openssl", "upgrade", "apt", true], // the image installs it
			["glibc", "rebase", "base image", true], // its base brought it
			["requests", "upgrade", "pip", true],
			["node", "none", "npm", false], // no fixed version
			["lodash", "addon", "npm", false], // inside a program it ships
		]);
		// an imported image without add-on information: every OS package is upgraded here
		const imported = classify(
			detail({
				imported: { source: "registry", from: "x", at: "", by: "" },
			}),
		);
		expect(imported[1].group).toBe("upgrade");
	});

	it("reads trivy's grouped targets (Python, Node.js) and Go programs", () => {
		const f = classify(
			detail({
				report: {
					...detail().report!,
					vulnerabilities: {
						counts: { CRITICAL: 3 },
						total: 3,
						fixable: 3,
						top: [
							vuln({
								pkg: "anyio",
								installed: "4.13.0",
								fixed: "4.14.2",
								target: "Python",
								class: undefined,
								type: undefined,
							}),
							vuln({
								pkg: "anyio",
								installed: "4.13.0",
								fixed: "4.14.2",
								target: "Python",
								class: undefined,
								type: undefined,
								path: "opt/unsloth/lib/python3.12/site-packages/anyio-4.13.0.dist-info/METADATA",
							}),
							vuln({
								pkg: "golang.org/x/net",
								installed: "v0.59.0",
								fixed: "0.60.0",
								target: "usr/local/bin/filebrowser",
								class: undefined,
								type: undefined,
							}),
							vuln({
								pkg: "tar",
								installed: "6.1.0",
								fixed: "6.2.1",
								target: "Node.js",
								class: undefined,
								type: undefined,
							}),
						],
					},
				},
			}),
		);
		expect(f.map((x) => [x.group, x.source, x.pip])).toEqual([
			["upgrade", "pip", "pip3"],
			["upgrade", "pip", "/opt/unsloth/bin/pip"],
			["addon", "go", undefined],
			["addon", "npm", undefined],
		]);
	});

	it("asks for the fixed version on the installed one's branch, with the environment's pip", () => {
		expect(pickFixed("2.28.1", "2.32.3, 2.28.9")).toBe("2.28.9");
		expect(pickFixed("1.0.0", "2.0.1, 3.0.0")).toBe("2.0.1");
		expect(pickFixed("1.0", "")).toBe("");
		expect(
			pipFor("opt/airflow/lib/python3.14/site-packages/requests/METADATA"),
		).toBe("/opt/airflow/bin/pip");
		expect(pipFor("usr/lib/python3/dist-packages/x/METADATA")).toBe("pip3");
		expect(pipFor("Python")).toBe("pip3");
	});

	it("writes the script that applies the selected fixes", () => {
		const f = classify(detail()).filter((x) => x.applicable);
		const lines = fixScript(f);
		expect(lines).toContain("apt-get update");
		expect(lines).toContain(
			"apt-get install -y --only-upgrade 'openssl' 'glibc'",
		);
		expect(lines).toContain(
			"/opt/airflow/bin/pip install --no-cache-dir 'requests>=2.28.9'",
		);
		expect(hunks(lines)).toBe(2);
		expect(fixScript([])).toHaveLength(1); // only its comment
	});

	it("grades what the selected fixes would leave", () => {
		const image = detail();
		const f = classify(image).filter((x) => x.applicable);
		// 2 critical, 3 high: fixing openssl, glibc and requests leaves node (critical, no fix) and lodash
		expect(gradeAfter(image, f).grade).toBe("D");
		expect(gradeAfter(image, []).grade).toBe("D");
		expect(gradeAfter(image, f).counts).toMatchObject({
			CRITICAL: 1,
			HIGH: 1,
		});
	});
});

const renderPage = (image: ImageDetail) => {
	vi.spyOn(ImagesAPI, "get").mockResolvedValue({ image });
	vi.spyOn(ImagesAPI, "list").mockResolvedValue({
		images: [{ name: "tool" }, { name: "tool-fixed" }] as ImageListItem[],
		canEdit: true,
		baseImage: "coder-workspace",
	} as Awaited<ReturnType<typeof ImagesAPI.list>>);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={[`/images/${image.id}/fix`]}>
				<Routes>
					<Route path="/images/:image/fix" element={<FixImagePage />} />
					<Route
						path="/images/:image/builds/:build"
						element={<div>Build page</div>}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
};

describe("FixImagePage", () => {
	afterEach(() => vi.restoreAllMocks());

	it("starts with every fixable finding selected, and the grade follows the selection", async () => {
		const user = userEvent.setup();
		renderPage(detail());
		expect(await screen.findAllByTestId("fix-finding")).toHaveLength(5);
		expect(screen.getByTestId("fix-group-upgrade")).toHaveTextContent(
			"2 findings",
		);
		expect(screen.getByText("3 findings selected")).toBeInTheDocument();
		expect(screen.getByTestId("fix-diff")).toHaveTextContent(
			"apt-get install -y --only-upgrade 'openssl' 'glibc'",
		);
		await user.click(screen.getByRole("button", { name: "Clear" }));
		expect(screen.getByText("0 findings selected")).toBeInTheDocument();
		expect(screen.getByTestId("fix-apply")).toBeDisabled();
		await user.click(
			screen.getByRole("checkbox", { name: "CVE-2026-0001 (openssl)" }),
		);
		expect(
			screen.getByRole("checkbox", { name: "CVE-2026-0001 (openssl)" }),
		).toHaveAttribute("aria-checked", "true");
		expect(screen.getByTestId("fix-after")).toHaveTextContent("1 crit");
	});

	it("applies the fixes to an image built here: a step in its spec, built and scanned again", async () => {
		const user = userEvent.setup();
		const save = vi
			.spyOn(ImagesAPI, "save")
			.mockResolvedValue({ image: detail() });
		const build = vi.spyOn(ImagesAPI, "build").mockResolvedValue({ build: 3 });
		renderPage(detail());
		await user.click(
			await screen.findByRole("button", {
				name: "Apply 3 fixes, rebuild and rescan",
			}),
		);
		await waitFor(() => expect(build).toHaveBeenCalledWith("tool"));
		const spec = save.mock.calls[0][1].spec;
		expect(spec?.installations).toHaveLength(1);
		expect(spec?.installations[0].id).toMatch(/^security-fixes-\d{8}$/);
		expect(spec?.installations[0].script).toContain("--only-upgrade");
		expect(await screen.findByText("Build page")).toBeInTheDocument();
	});

	it("builds a fixed copy of an imported image, under a free name", async () => {
		const user = userEvent.setup();
		const imported = detail({
			imported: {
				source: "registry",
				from: "ghcr.io/x/tool:1",
				at: "",
				by: "",
			},
		});
		const create = vi
			.spyOn(ImagesAPI, "create")
			.mockResolvedValue({ image: detail({ id: "tool-fixed-2" }) });
		vi.spyOn(ImagesAPI, "save").mockResolvedValue({ image: detail() });
		const build = vi.spyOn(ImagesAPI, "build").mockResolvedValue({ build: 1 });
		renderPage(imported);
		await user.click(
			await screen.findByRole("button", {
				name: /Build a fixed copy with 3 fixes/,
			}),
		);
		await waitFor(() => expect(build).toHaveBeenCalledWith("tool-fixed-2"));
		expect(create).toHaveBeenCalledWith("tool-fixed-2", expect.any(String), {
			kind: "image",
			id: "tool",
		});
	});

	it("keeps the agent, pull requests and accepting a risk off until their APIs exist", async () => {
		const user = userEvent.setup();
		renderPage(detail());
		expect(
			await screen.findByRole("button", { name: "Accept risk…" }),
		).toBeDisabled();
		expect(
			screen.getByRole("checkbox", {
				name: "Open as a pull request instead of committing",
			}),
		).toBeDisabled();
		await user.click(screen.getByRole("tab", { name: "Hand to an agent" }));
		expect(
			screen.getByRole("button", { name: "Hand 3 findings to the agent" }),
		).toBeDisabled();
		expect(screen.getByText(/docs\/fix-image-api\.md/)).toBeInTheDocument();
	});

	it("cannot build on an image scanned in place: it says to import it", async () => {
		renderPage(detail({ scanned: { image: "registry:3" }, ref: null }));
		const button = await screen.findByTestId("fix-apply");
		expect(button).toBeDisabled();
		expect(button).toHaveTextContent("Import the image to build a fixed copy");
		expect(screen.getByTestId("fix-import")).toHaveTextContent(
			"Import registry:3",
		);
		expect(
			within(screen.getByTestId("fix-activity")).getByText(/scanned as it is/),
		).toBeInTheDocument();
	});
});

describe("the Images list's ways in", () => {
	afterEach(() => vi.restoreAllMocks());

	const item = (over: Partial<ImageListItem>): ImageListItem =>
		({
			...detail(),
			summary: {
				grade: "A",
				counts: {},
				fixable: 0,
				secrets: 0,
				fips: null,
				scannedAt: null,
				dbUpdatedAt: null,
				checks: { pass: 0, warn: 0, fail: 0 },
			},
			...over,
		}) as ImageListItem;

	it("tags what needs fixing, says what fixing gives, and narrows the list to it", async () => {
		const user = userEvent.setup();
		const never = () => new Promise<never>(() => {});
		for (const name of [
			"contents",
			"inUse",
			"onNodes",
			"library",
			"securityData",
			"modelScanner",
		] as const) {
			vi.spyOn(ImagesAPI, name).mockImplementation(never);
		}
		vi.spyOn(ImagesAPI, "list").mockResolvedValue({
			canEdit: true,
			baseImage: "coder-workspace",
			images: [
				item({
					id: "ai",
					name: "ai",
					summary: {
						...item({}).summary!,
						grade: "D",
						counts: { CRITICAL: 3, HIGH: 34 },
						fixable: 31,
						fixableCounts: { CRITICAL: 3, HIGH: 28 },
						projectedGrade: "B",
						needsFixing: true,
					},
				}),
				item({
					id: "ws",
					name: "ws",
					summary: {
						...item({}).summary!,
						grade: "C",
						counts: { HIGH: 1 },
						fixable: 1,
						fixableCounts: { HIGH: 1 },
						projectedGrade: "A",
						needsFixing: false,
					},
				}),
				item({ id: "clean", name: "clean" }),
			],
		} as Awaited<ReturnType<typeof ImagesAPI.list>>);
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<ImagesPage />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		const ai = await screen.findByTestId("image-ai");
		expect(within(ai).getByTestId("needs-fixing")).toBeInTheDocument();
		expect(within(ai).getByTestId("image-projected")).toHaveTextContent(
			"31 fixable → B",
		);
		expect(within(ai).getByRole("link", { name: "Fix CVEs" })).toHaveAttribute(
			"href",
			"/images/ai/fix",
		);
		const ws = screen.getByTestId("image-ws");
		expect(within(ws).queryByTestId("needs-fixing")).toBeNull();
		expect(
			within(ws).getByRole("link", { name: "View fix →" }),
		).toHaveAttribute("href", "/images/ws/fix");
		expect(
			within(screen.getByTestId("image-clean")).queryByText("View fix →"),
		).toBeNull();

		const filter = screen.getByTestId("images-need-fixing");
		expect(filter).toHaveTextContent("1 image needs fixing");
		await user.click(filter);
		expect(filter).toHaveAttribute("aria-pressed", "true");
		expect(screen.queryByTestId("image-ws")).toBeNull();
		expect(screen.getByTestId("image-ai")).toBeInTheDocument();
	});
});
