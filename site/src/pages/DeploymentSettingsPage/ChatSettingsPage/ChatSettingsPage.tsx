import { ChatConsoleCard } from "#/modules/platform/chat/ChatConsoleCard";
import { ChatConsoleWhenOn } from "#/modules/platform/chat/ChatOffConsole";
import { pageTitle } from "#/utils/page";

const ChatSettingsPage = () => (
	<>
		<title>{pageTitle("Chat")}</title>
		<ChatConsoleWhenOn>
			<ChatConsoleCard />
		</ChatConsoleWhenOn>
	</>
);

export {
	DiscoveryCard,
	PairsCard,
	ScreenSharingCard,
} from "#/modules/platform/chat/ChatConsolePanels";
export default ChatSettingsPage;
