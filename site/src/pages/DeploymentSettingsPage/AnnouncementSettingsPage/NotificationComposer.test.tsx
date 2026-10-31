import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { NotificationComposer } from "./NotificationComposer";

beforeEach(() => {
	vi.spyOn(API, "getUsers").mockResolvedValue({
		users: [MockUserOwner, MockUserMember],
		count: 2,
	});
});
afterEach(() => vi.restoreAllMocks());

it("sends edited content only to selected recipients after confirmation", async () => {
	const send = vi
		.spyOn(API, "postCustomNotification")
		.mockResolvedValue(undefined);
	const user = userEvent.setup();
	render(<NotificationComposer canEdit />);
	await user.type(
		screen.getByRole("textbox", { name: "Notification title" }),
		"Maintenance",
	);
	await user.type(
		screen.getByRole("textbox", { name: "Notification message" }),
		"Save your work.",
	);
	await user.click(
		await screen.findByRole("checkbox", {
			name: `Select user ${MockUserOwner.username}`,
		}),
	);
	await user.click(
		screen.getByRole("checkbox", {
			name: `Select user ${MockUserMember.username}`,
		}),
	);
	await user.click(
		screen.getByRole("button", {
			name: `Remove recipient ${MockUserOwner.username}`,
		}),
	);
	await user.click(screen.getByRole("button", { name: "Send notification" }));
	expect(send).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
	);
	await user.type(
		screen.getByRole("textbox", { name: "Notification message" }),
		" At 22:00.",
	);
	await user.click(screen.getByRole("button", { name: "Send notification" }));
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Send notification",
		}),
	);
	await waitFor(() =>
		expect(send).toHaveBeenCalledWith({
			content: { title: "Maintenance", message: "Save your work. At 22:00." },
			user_ids: [MockUserMember.id],
		}),
	);
});

it("retains the draft and targets when delivery fails", async () => {
	const send = vi
		.spyOn(API, "postCustomNotification")
		.mockRejectedValueOnce(new Error("Service unavailable"))
		.mockResolvedValue(undefined);
	const user = userEvent.setup();
	render(<NotificationComposer canEdit />);
	await user.type(
		screen.getByRole("textbox", { name: "Notification title" }),
		"Update",
	);
	await user.type(
		screen.getByRole("textbox", { name: "Notification message" }),
		"Try again",
	);
	await user.click(
		await screen.findByRole("checkbox", {
			name: `Select user ${MockUserMember.username}`,
		}),
	);
	await user.click(screen.getByRole("button", { name: "Send notification" }));
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Send notification",
		}),
	);
	await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Send notification",
		}),
	);
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});

it("does not send without administrator permission", async () => {
	const send = vi
		.spyOn(API, "postCustomNotification")
		.mockResolvedValue(undefined);
	const user = userEvent.setup();
	render(<NotificationComposer canEdit={false} />);
	await user.click(screen.getByRole("button", { name: "Send notification" }));
	expect(send).not.toHaveBeenCalled();
});

it("searches recipients without double-encoding the filter", async () => {
	const user = userEvent.setup();
	render(<NotificationComposer canEdit />);
	await user.type(
		screen.getByRole("textbox", { name: "Search users" }),
		"Test User",
	);
	await waitFor(
		() =>
			expect(API.getUsers).toHaveBeenCalledWith(
				{ q: "status:active Test User", limit: 25 },
				expect.any(AbortSignal),
			),
		{ timeout: 2000 },
	);
});
