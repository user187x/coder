import { screen } from "@testing-library/react";
import { type CloudDriveConnections, PlatformAPI } from "#/api/platform";
import { MockUserOwner, MockWorkspace } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { CloudDriveAttachBadge } from "./CloudDriveAttachBadge";

const connections = (
	extra: Partial<CloudDriveConnections>,
): CloudDriveConnections => ({
	disconnected: [],
	older: [],
	shared: [],
	...extra,
});

const mine = {
	...MockWorkspace,
	owner_id: MockUserOwner.id,
	latest_build: { ...MockWorkspace.latest_build, status: "running" as const },
};

describe("CloudDriveAttachBadge", () => {
	afterEach(() => vi.restoreAllMocks());

	it("glows beside a running workspace until its Cloud Drive is attached", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue(
			connections({ attachment: { [mine.id]: "waiting" } }),
		);
		renderWithAuth(<CloudDriveAttachBadge workspace={mine} />);
		const badge = await screen.findByTestId("cloud-drive-attaching");
		expect(badge).toHaveAttribute("data-attachment", "waiting");
		expect(badge).toHaveClass("cd-attaching");
		expect(badge).toHaveAccessibleName(/attaching to this workspace/);
	});

	it("is not there once attached, while stopped, disconnected or someone else's", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getCloudDriveConnections")
			.mockResolvedValue(
				connections({
					disconnected: ["off"],
					attachment: { [mine.id]: "attached", off: "detached" },
				}),
			);
		const { unmount } = renderWithAuth(
			<CloudDriveAttachBadge workspace={mine} />,
		);
		await vi.waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("cloud-drive-attaching")).toBeNull();
		unmount();
		for (const workspace of [
			{ ...mine, id: "off" },
			{
				...mine,
				latest_build: { ...mine.latest_build, status: "stopped" as const },
			},
			{ ...mine, owner_id: "someone-else" },
		]) {
			const view = renderWithAuth(
				<CloudDriveAttachBadge workspace={workspace} />,
			);
			await new Promise((r) => setTimeout(r, 20));
			expect(screen.queryByTestId("cloud-drive-attaching")).toBeNull();
			view.unmount();
		}
	});
});
