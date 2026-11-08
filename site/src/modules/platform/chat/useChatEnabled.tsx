import { useEffect } from "react";
import { useQuery } from "react-query";
import { chatEnabled } from "#/api/queries/platform";
import { CHAT_OFF_EVENT } from "./chatStore";

/**
 * Whether the deployment has chat: false until the server says it is on, and as soon as an admin turns it off
 * (a chat request that finds it off re-checks at once). Every chat element renders nothing without it.
 */
export const useChatEnabled = (): boolean => {
	const query = useQuery(chatEnabled());
	const { refetch } = query;
	useEffect(() => {
		const recheck = () => void refetch();
		window.addEventListener(CHAT_OFF_EVENT, recheck);
		return () => window.removeEventListener(CHAT_OFF_EVENT, recheck);
	}, [refetch]);
	return query.data?.enabled === true;
};

/** Renders its children only while the deployment has chat. */
export const ChatGate: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (useChatEnabled() ? children : null);
