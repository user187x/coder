import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { type CloudDriveShare, PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AccountShareCables, SHARE_HOVER } from "./AccountShareCables";

const share = (
	id: string,
	owner: string,
	from: string,
	over: Partial<CloudDriveShare> = {},
): CloudDriveShare => ({
	id,
	owner,
	ownerName: owner,
	from,
	fromName: from,
	access: "read",
	asked: "read",
	state: "active",
	askedAt: 1,
	kind: "drive",
	path: "",
	by: "request",
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

/** Three account rows (ann, bob, eve), 60 high, 800 wide, in a table; the drawing at (0, 0). */
const renderTable = (shares: CloudDriveShare[], enabled = true) => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue({
		settings: {
			enabled,
			adminApproval: true,
			updatedBy: null,
			updatedAt: null,
		},
		admin: true,
		me: "ann",
		asked: [],
		ofMine: [],
		all: shares,
	});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const i = ["ann", "bob", "eve"].indexOf(
				this.dataset.testid?.replace("user-", "") ?? "",
			);
			return i >= 0 ? rect(0, 100 + i * 60, 800, 60) : rect(0, 0, 0, 0);
		},
	);
	return renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountShareCables userIds={["ann", "bob", "eve"]}>
				<table>
					<tbody>
						{["ann", "bob", "eve"].map((id) => (
							<tr key={id} data-testid={`user-${id}`}>
								<td>{id}</td>
							</tr>
						))}
					</tbody>
				</table>
			</AccountShareCables>
		</QueryClientProvider>,
	);
};

const cables = () =>
	[
		...screen
			.getByTestId("account-share-cables")
			.querySelectorAll<SVGGElement>("g[data-share]"),
	].filter((g) => g.getAttribute("visibility") === "visible");

describe("AccountShareCables", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("cables each owner's row to the rows its Cloud Drive is shared with", async () => {
		renderTable([
			share("s1", "ann", "eve", { access: "write" }),
			share("s2", "bob", "eve", { state: "approval" }),
			share("s3", "bob", "zed"),
		]);
		await waitFor(() => expect(cables()).toHaveLength(1));
		const [cable] = cables();
		expect(cable.dataset).toMatchObject({
			owner: "ann",
			to: "eve",
			access: "write",
		});
		// out of ann's socket at her row's right end (130 down), looping round into the plug at eve's (250 down)
		const d = cable.querySelector("path.cd-cable")?.getAttribute("d");
		expect(d).toMatch(/^M807,130 C/);
		expect(d).toMatch(/ 815,250$/);
		expect(cable.querySelector(".cd-plug")?.getAttribute("transform")).toBe(
			"translate(815,250) rotate(180)",
		);
		expect(
			screen
				.getByTestId("account-share-cables")
				.querySelector('g[data-socket="ann"]')
				?.getAttribute("transform"),
		).toBe("translate(800,130)");
		expect(cable.querySelector("title")?.textContent).toBe(
			"ann's Cloud Drive, shared with eve (read and write)",
		);
		expect(screen.getByTestId("account-shares-legend")).toHaveTextContent(
			"1 more with an account not on this page.",
		);
	});

	it("marks both rows of the cable pointed at", async () => {
		renderTable([share("s1", "ann", "bob")]);
		await waitFor(() => expect(cables()).toHaveLength(1));
		fireEvent.pointerOver(
			cables()[0].querySelector(".cd-share-hit") as Element,
		);
		expect(screen.getByTestId("user-ann").getAttribute(SHARE_HOVER)).toBe(
			"owner",
		);
		expect(screen.getByTestId("user-bob").getAttribute(SHARE_HOVER)).toBe("to");
		expect(screen.getByTestId("user-eve").hasAttribute(SHARE_HOVER)).toBe(
			false,
		);
		fireEvent.pointerOut(cables()[0].querySelector(".cd-share-hit") as Element);
		expect(screen.getByTestId("user-ann").hasAttribute(SHARE_HOVER)).toBe(
			false,
		);
	});

	it("draws nothing while sharing between users is off", async () => {
		renderTable([share("s1", "ann", "bob")], false);
		await new Promise((r) => setTimeout(r, 100));
		expect(cables()).toHaveLength(0);
		expect(screen.queryByTestId("account-shares-legend")).toBeNull();
	});
});
