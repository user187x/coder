import { ChatConsoleWindow } from "#/modules/platform/chat/ChatConsoleCard";
import { ChatConsoleWhenOn } from "#/modules/platform/chat/ChatOffConsole";
import { pageTitle } from "#/utils/page";

/** /chat-console: admins' chat console popped out of the Chat page into a window of its own. */
const ChatConsoleWindowPage: React.FC = () => (
	<>
		<title>{pageTitle("Chat console")}</title>
		<ChatConsoleWhenOn>
			<ChatConsoleWindow />
		</ChatConsoleWhenOn>
	</>
);

export default ChatConsoleWindowPage;
