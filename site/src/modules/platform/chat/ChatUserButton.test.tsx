import { screen } from "@testing-library/react";
import { MockUserMember } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { ChatUserButton } from "./ChatUserButton";
import type * as ChatStore from "./chatStore";

const chat = vi.hoisted(() => ({ unread: 0 }));
vi.mock("./chatStore", async (original) => ({
	...(await original<typeof ChatStore>()),
	useChatSnapshot: () => ({
		me: { id: "admin-id", admin: true },
		conversations: new Map([[MockUserMember.id, { unread: chat.unread }]]),
	}),
}));

afterEach(() => {
	chat.unread = 0;
});

it("says how many of the user's messages are unread, while any are", async () => {
	chat.unread = 2;
	render(<ChatUserButton user={MockUserMember} />);
	expect(
		await screen.findByRole("button", {
			name: `Chat with ${MockUserMember.username}, 2 unread`,
		}),
	).toHaveTextContent("Chat");
});

it("is the plain Chat button with nothing unread", async () => {
	render(<ChatUserButton user={MockUserMember} />);
	expect(
		await screen.findByRole("button", {
			name: `Chat with ${MockUserMember.username}`,
		}),
	).toHaveTextContent("Chat");
});
