import { useQuery } from "react-query";
import { chatEnabled } from "#/api/queries/platform";
import { Loader } from "#/components/Loader/Loader";
import { ChatEnabledCard } from "./ChatConsolePanels";

/**
 * Admins' chat console while chat is off for the deployment: its switch, to turn it back on, over the console greyed
 * out and out of reach (nothing of it loads, as every chat request is refused).
 */
const ChatOffConsole: React.FC = () => (
	<div className="flex flex-col gap-4">
		<ChatEnabledCard enabled={false} />
		<div
			inert
			aria-hidden
			className="pointer-events-none flex min-h-64 select-none flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary opacity-40 grayscale"
		>
			<div className="flex gap-4 border-0 border-b border-solid border-border px-3 py-2.5 text-sm text-content-secondary">
				<span>Conversations</span>
				<span>People</span>
				<span>Connections</span>
				<span>Settings</span>
			</div>
			<div className="flex flex-1 items-center justify-center p-8 text-sm text-content-secondary">
				Chat is turned off for everyone.
			</div>
		</div>
	</div>
);

/** The console where chat is on; the greyed console with its switch where it is off. */
export const ChatConsoleWhenOn: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const query = useQuery(chatEnabled());
	if (!query.data) {
		return <Loader />;
	}
	return query.data.enabled ? children : <ChatOffConsole />;
};
