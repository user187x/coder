import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { type CloudDriveShare, PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { SharedDriveClouds } from "./SharedDriveClouds";

const share = (
	id: string,
	owner: string,
	over: Partial<CloudDriveShare> = {},
): CloudDriveShare => ({
	id,
	owner,
	ownerName: owner,
	from: "me",
	fromName: "me",
	access: "read",
	asked: "read",
	state: "active",
	askedAt: 1,
	...over,
});

const rect = (x: number, y: number, w: number, h: number) =>
	({
		x,
		y,
		left: x,
		top: y,
		right: x + w,
		bottom: y + h,
		width: w,
		height: h,
		toJSON: () => ({}),
	}) as DOMRect;

const Harness: React.FC<{ onOpen: (owner: string) => void }> = ({ onOpen }) => {
	const button = useRef<HTMLButtonElement>(null);
	return (
		<div data-cloud-drive-area>
			<button ref={button} type="button" data-testid="cloud-drive">
				Cloud Drive
			</button>
			<SharedDriveClouds anchor={button} onOpen={onOpen} />
		</div>
	);
};

/** The Cloud Drive button at (1000, 400), 340 wide; the drawing at (0, 0). */
const renderClouds = (shares: CloudDriveShare[], enabled = true) => {
	const peers = vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue({
		settings: {
			enabled,
			adminApproval: true,
			updatedBy: null,
			updatedAt: null,
		},
		admin: false,
		me: "me",
		asked: shares,
		ofMine: [],
	});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return this.dataset.testid === "cloud-drive"
				? rect(1000, 400, 340, 40)
				: rect(0, 0, 0, 0);
		},
	);
	const onOpen = vi.fn();
	const client = new QueryClient();
	renderComponent(
		<QueryClientProvider client={client}>
			<Harness onOpen={onOpen} />
		</QueryClientProvider>,
	);
	return { onOpen, peers, client };
};

const tether = (owner: string) =>
	screen
		.getByTestId("shared-drive-clouds")
		.querySelector<SVGGElement>(`g[data-tether="${owner}"]`);

describe("SharedDriveClouds", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("floats a cloud above the Cloud Drive for each drive shared with the user, plugged into it", async () => {
		renderClouds([
			share("s1", "bob", { access: "write" }),
			share("s2", "ann"),
			share("s3", "eve", { state: "approval" }),
		]);
		const ann = await screen.findByTestId("shared-drive-cloud-ann");
		const bob = screen.getByTestId("shared-drive-cloud-bob");
		expect(screen.queryByTestId("shared-drive-cloud-eve")).toBeNull();
		// ann's first (by name), over the button's glyph; bob's next to it
		await waitFor(() =>
			expect(ann.style.transform).toBe("translate(995px,320px)"),
		);
		expect(bob.style.transform).toBe("translate(1059px,320px)");
		expect(ann.dataset.access).toBe("read");
		expect(bob.dataset.access).toBe("write");
		expect(ann).toHaveAccessibleName(
			"ann's Cloud Drive, shared with you (read only): open it",
		);
		// its cable from the cloud's underside down into the plug, in the socket on the button's top edge
		const g = tether("ann");
		expect(g?.getAttribute("visibility")).toBe("visible");
		expect(g?.querySelector("path.cd-cable")?.getAttribute("d")).toMatch(
			/^M1025,357 C.* 1025,381$/,
		);
		expect(g?.querySelector(".cd-plug")?.getAttribute("transform")).toBe(
			"translate(1025,381) rotate(90)",
		);
		expect(
			screen
				.getByTestId("shared-drive-clouds")
				.querySelector('g[data-cloud-socket="ann"]')
				?.getAttribute("transform"),
		).toBe("translate(1025,400)");
	});

	it("shows its owner, the access, how many files and how much, the newest, pointed at", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveGlance").mockResolvedValue({
			files: 9,
			usedBytes: 3 * 1024 * 1024,
			newest: [
				{ path: "docs/plan.md", size: 2048, modified: null },
				{ path: "a.txt", size: 10, modified: null },
			],
			owner: { id: "bob", username: "bob", name: "Bob Stone" },
		});
		renderClouds([share("s1", "bob", { access: "write" })]);
		const cloud = await screen.findByTestId("shared-drive-cloud-bob");
		fireEvent.focus(cloud);
		const hud = await screen.findByTestId("shared-drive-hud");
		await waitFor(() => expect(hud).toHaveTextContent("Bob Stone @bob"));
		expect(PlatformAPI.getCloudDriveGlance).toHaveBeenCalledWith("bob");
		expect(screen.getByTestId("shared-drive-hud-access")).toHaveTextContent(
			"Read and write",
		);
		expect(screen.getByTestId("shared-drive-hud-size")).toHaveTextContent(
			"3 MB in 9 files",
		);
		expect(hud).toHaveTextContent("docs/plan.md");
		expect(hud).toHaveTextContent("and 7 more");
		expect(hud).toHaveTextContent("~/cloud-drive-shared/bob");
		expect(tether("bob")?.hasAttribute("data-lit")).toBe(true);
	});

	it("opens the Cloud Drive on it, clicked", async () => {
		const { onOpen } = renderClouds([share("s1", "bob")]);
		fireEvent.click(await screen.findByTestId("shared-drive-cloud-bob"));
		expect(onOpen).toHaveBeenCalledWith("bob");
	});

	it("takes the cloud away when the share ends, and draws none while sharing is off", async () => {
		const { peers, client } = renderClouds([
			share("s1", "bob"),
			share("s2", "ann"),
		]);
		await screen.findByTestId("shared-drive-cloud-bob");
		peers.mockResolvedValue({
			settings: {
				enabled: true,
				adminApproval: true,
				updatedBy: null,
				updatedAt: null,
			},
			admin: false,
			me: "me",
			asked: [share("s1", "bob", { state: "ended" }), share("s2", "ann")],
			ofMine: [],
		});
		await client.invalidateQueries();
		await waitFor(() =>
			expect(screen.queryByTestId("shared-drive-cloud-bob")).toBeNull(),
		);
		// ann's stays, where it was
		expect(screen.getByTestId("shared-drive-cloud-ann").style.transform).toBe(
			"translate(995px,320px)",
		);
	});

	it("draws nothing while sharing between users is off", async () => {
		const { peers } = renderClouds([share("s1", "bob")], false);
		await waitFor(() => expect(peers).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByTestId("shared-drive-cloud-bob")).toBeNull();
	});
});
