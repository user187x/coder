import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { onlineUsers } from "#/api/queries/platform";
import { MockOnlineChatUser } from "#/testHelpers/chat";
import { MockUserMember } from "#/testHelpers/entities";
import { AccountPresence, useAccountPresence } from "./AccountPresence";

let presenceVersion = 0;
vi.mock("#/modules/platform/chat/chatStore", () => ({
	useChatSnapshot: () => ({ presenceVersion }),
}));

it("refreshes shared account presence immediately on a live change", async () => {
	presenceVersion = 0;
	const report = {
		online: [],
		recent: [],
		idleSeconds: 30,
		generatedAt: "2026-11-02T12:00:00Z",
	};
	const getPresence = vi
		.spyOn(PlatformAPI, "getPresence")
		.mockResolvedValue(report);
	const View = () => {
		const presence = useAccountPresence(true);
		return (
			<>
				<AccountPresence user={MockUserMember} presence={presence} />
				<AccountPresence
					user={{ ...MockUserMember, id: "another-user" }}
					presence={presence}
				/>
			</>
		);
	};
	const queryClient = new QueryClient();
	const { rerender } = render(<View />, {
		wrapper: ({ children }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	});
	await waitFor(() =>
		expect(queryClient.getQueryData(onlineUsers().queryKey)).toEqual(report),
	);
	const updated = {
		...report,
		online: [{ ...MockOnlineChatUser, id: MockUserMember.id }],
	};
	getPresence.mockResolvedValue(updated);
	presenceVersion = 1;
	rerender(<View />);
	await waitFor(() =>
		expect(queryClient.getQueryData(onlineUsers(1).queryKey)).toEqual(updated),
	);
	expect(getPresence).toHaveBeenCalledTimes(2);
});
