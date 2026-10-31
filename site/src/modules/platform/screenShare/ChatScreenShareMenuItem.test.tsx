import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScreenShareAPI } from "#/api/screenShare";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
import { MockScreenShare } from "#/testHelpers/screenShare";
import { ChatScreenShareMenuItem } from "./ChatScreenShareMenuItem";

afterEach(() => vi.restoreAllMocks());
it.each([
	{ admin: true, canShare: true },
	{ admin: true, canShare: false },
	{ admin: false, canShare: true },
	{ admin: false, canShare: false },
])(
	"uses the correct direction for admin=$admin and honors permission=$canShare",
	async ({ admin, canShare }) => {
		vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
			sessions: [],
			iceServers: [],
			canShare,
		});
		const create = vi
			.spyOn(ScreenShareAPI, "update")
			.mockResolvedValue({ session: MockScreenShare });
		render(
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>More</DropdownMenuTrigger>
				<DropdownMenuContent>
					<ChatScreenShareMenuItem
						peer={MockScreenShare.viewer}
						disabled={false}
						admin={admin}
					/>
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		await userEvent.click(
			await screen.findByRole("menuitem", {
				name: admin ? "Request Control" : "Share screen",
			}),
		);
		if (canShare)
			await waitFor(() =>
				expect(create).toHaveBeenCalledWith({
					action: admin ? "request_peer" : "create",
					peer: MockScreenShare.viewer,
					...(admin ? { mode: "dashboard" } : {}),
				}),
			);
		else expect(create).not.toHaveBeenCalled();
	},
);
