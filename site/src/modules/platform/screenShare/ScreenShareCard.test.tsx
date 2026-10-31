import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ScreenShareAPI } from "#/api/screenShare";
import { MockMonitoringOverview } from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";
import { MockScreenShare } from "#/testHelpers/screenShare";
import { stopMedia, updateMedia } from "./media";
import { ScreenShareCard } from "./ScreenShareCard";

afterEach(() => {
	act(() => stopMedia());
	vi.restoreAllMocks();
});

it.each(["DEV", "testuser2", "test2@coder.com"])(
	"requests the workspace selected through search for %s",
	async (search) => {
		const request = vi
			.spyOn(ScreenShareAPI, "update")
			.mockResolvedValue({ session: MockScreenShare });
		render(<ScreenShareCard overview={MockMonitoringOverview} />);
		await userEvent.type(
			screen.getByRole("combobox", { name: "Search workspaces or users" }),
			search,
		);
		await userEvent.keyboard("{ArrowDown}{Enter}");
		await userEvent.click(
			screen.getByRole("button", { name: "Request dashboard control" }),
		);
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith({
				action: "request",
				workspace: "ws-1",
				mode: "dashboard",
			}),
		);
	},
);

it("clears the previous selection while searching and preserves a selection across refreshes", async () => {
	const request = vi
		.spyOn(ScreenShareAPI, "update")
		.mockResolvedValue({ session: MockScreenShare });
	const RefreshedOverview = () => {
		const [overview, setOverview] = useState(MockMonitoringOverview);
		return (
			<>
				<button
					onClick={() =>
						setOverview({ ...overview, users: [...overview.users] })
					}
				>
					Refresh workspaces
				</button>
				<ScreenShareCard overview={overview} />
			</>
		);
	};
	render(<RefreshedOverview />);
	const search = screen.getByRole("combobox", {
		name: "Search workspaces or users",
	});
	await userEvent.click(search);
	await userEvent.click(screen.getByRole("option", { name: "TestUser2/dev" }));
	await userEvent.type(search, "missing");
	await userEvent.click(
		screen.getByRole("button", { name: "Request dashboard control" }),
	);
	expect(request).not.toHaveBeenCalled();
	await userEvent.clear(search);
	await userEvent.type(search, "dev");
	await userEvent.keyboard("{Enter}");
	await userEvent.click(
		screen.getByRole("button", { name: "Refresh workspaces" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Request dashboard control" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith({
			action: "request",
			workspace: "ws-1",
			mode: "dashboard",
		}),
	);
});

it("disconnects the current support session", async () => {
	updateMedia({ id: MockScreenShare.id, status: "Waiting for screen" });
	const end = vi
		.spyOn(ScreenShareAPI, "update")
		.mockResolvedValue({ session: { ...MockScreenShare, status: "ended" } });
	render(<ScreenShareCard overview={MockMonitoringOverview} />);
	await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(end).toHaveBeenCalledWith({ action: "end", id: MockScreenShare.id }),
	);
});
