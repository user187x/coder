import { screen } from "@testing-library/react";
import { MockUserMember } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
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

it("says how many of the user's messages are unread, while any are", () => {
	chat.unread = 2;
	renderComponent(<ChatUserButton user={MockUserMember} />);
	expect(
		screen.getByRole("button", {
			name: `Chat with ${MockUserMember.username}, 2 unread`,
		}),
	).toHaveTextContent("Chat");
});

it("is the plain Chat button with nothing unread", () => {
	renderComponent(<ChatUserButton user={MockUserMember} />);
	expect(
		screen.getByRole("button", {
			name: `Chat with ${MockUserMember.username}`,
		}),
	).toHaveTextContent("Chat");
});
