import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { render } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { CHAT_OFF_EVENT } from "./chatStore";
import { ChatGate } from "./useChatEnabled";

const answer = (enabled: boolean) =>
	server.use(
		http.get("/__coder-ui/api/chat/enabled", () =>
			HttpResponse.json({ enabled }),
		),
	);

it("shows chat where the deployment has it", async () => {
	answer(true);
	render(<ChatGate>chat bar</ChatGate>);
	expect(await screen.findByText("chat bar")).toHaveTextContent("chat bar");
});

it("leaves nothing of chat while it is turned off", async () => {
	answer(false);
	render(<ChatGate>chat bar</ChatGate>);
	await waitFor(() => expect(screen.queryByText("chat bar")).toBeNull());
});

it("removes chat at once when a chat request finds it turned off", async () => {
	answer(true);
	render(<ChatGate>chat bar</ChatGate>);
	await screen.findByText("chat bar");
	answer(false);
	window.dispatchEvent(new Event(CHAT_OFF_EVENT));
	await waitFor(() => expect(screen.queryByText("chat bar")).toBeNull());
});
