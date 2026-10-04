import { useEffect } from "react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import { avatarDefaults } from "#/api/queries/platform";
import {
	getPlatformSnapshot,
	setDefaultAvatarUsers,
} from "#/contexts/platformBoot";
import { ChatDock } from "./chat/ChatDock";

/**
 * What the platform adds to every signed-in dashboard page: the chat, the
 * list of users who get the default avatar, and navigation for dashboard
 * pages embedded in this one (they navigate this page, not their frame).
 */
export const DashboardAddons: React.FC = () => {
	const navigate = useNavigate();
	// Who gets the default avatar is only told to signed-in pages; boot.js
	// starts each page with this browser's last answer.
	const defaultsQuery = useQuery({
		...avatarDefaults(),
		enabled: Boolean(getPlatformSnapshot().defaultAvatarURL),
	});
	const defaultUsers = defaultsQuery.data?.users;

	useEffect(() => {
		if (defaultUsers) {
			setDefaultAvatarUsers(defaultUsers);
		}
	}, [defaultUsers]);

	useEffect(() => {
		window.__platformNavigate = (url) => navigate(url);
		return () => {
			window.__platformNavigate = undefined;
		};
	}, [navigate]);

	return <ChatDock />;
};
