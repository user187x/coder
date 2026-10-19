import { ChatConsoleWindow } from "#/modules/platform/chat/ChatConsoleCard";
import { pageTitle } from "#/utils/page";

/** /chat-console: admins' chat console popped out of the Chat page into a window of its own. */
const ChatConsoleWindowPage: React.FC = () => (
	<>
		<title>{pageTitle("Chat console")}</title>
		<ChatConsoleWindow />
	</>
);

export default ChatConsoleWindowPage;
