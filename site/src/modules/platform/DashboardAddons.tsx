import { useEffect } from "react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import { dashboardBackground } from "#/api/queries/backgrounds";
import { avatarDefaults, myAvatar } from "#/api/queries/platform";
import {
	getPlatformSnapshot,
	setBackground,
	setDefaultAvatarUsers,
	setUserAvatar,
} from "#/contexts/platformBoot";
import { PlatformBackground } from "./background/PlatformBackground";
import { ChatDock } from "./chat/ChatDock";
import { ChatGate } from "./chat/useChatEnabled";
import { PanelAccent } from "./panelAccent/PanelAccent";
import { ScreenShareController } from "./screenShare/ScreenShareController";

/**
 * What the platform adds to every signed-in dashboard page: the chat, the
 * background image, the panel accent colour, the list of users who get the default avatar, and
 * navigation for dashboard pages embedded in this one (they navigate this
 * page, not their frame).
 */
export const DashboardAddons: React.FC = () => {
	const navigate = useNavigate();
	const { data: background } = useQuery(dashboardBackground());
	const { data: avatar } = useQuery({ ...myAvatar(), refetchInterval: 30_000 });

	useEffect(() => {
		if (background) {
			setBackground("dashboard", background.dashboard);
		}
	}, [background]);

	useEffect(() => {
		if (avatar?.available) {
			setUserAvatar(avatar.username, avatar.url);
		}
	}, [avatar]);
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

	return (
		<>
			<PlatformBackground slot="dashboard" />
			<PanelAccent />
			<ChatGate>
				<ChatDock />
			</ChatGate>
			<ScreenShareController />
		</>
	);
};
