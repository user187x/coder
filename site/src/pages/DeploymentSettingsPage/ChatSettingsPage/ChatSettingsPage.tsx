import { ChatConsoleCard } from "#/modules/platform/chat/ChatConsoleCard";
import { pageTitle } from "#/utils/page";

const ChatSettingsPage = () => (
	<>
		<title>{pageTitle("Chat")}</title>
		<ChatConsoleCard />
	</>
);

export {
	DiscoveryCard,
	PairsCard,
	ScreenSharingCard,
} from "#/modules/platform/chat/ChatConsolePanels";
export default ChatSettingsPage;
