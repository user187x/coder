import { useNavigate } from "react-router";
import type { BuildInfoResponse, User } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { settingsSections } from "#/pages/UserSettingsPage/settingsSections";

/**
 * The Settings menu's Account button: the user's avatar, which opens User Settings; its right-click menu lists User
 * Settings' sections, each with its icon, as its own list has them.
 */
export const UserSettingsShortcut: React.FC<{
	user: User;
	buildInfo?: BuildInfoResponse;
}> = ({ user, buildInfo }) => {
	const navigate = useNavigate();
	// As User Settings' own list: no Appearance (it has a page of its own), OAuth2 only where Coder provides it, and
	// no Schedule (an Enterprise feature the platform's open-source Coder lacks).
	const sections = Object.entries(settingsSections).filter(
		([path]) =>
			path !== "appearance" &&
			path !== "schedule" &&
			(path !== "oauth2-provider" || Boolean(buildInfo?.oauth2_provider)),
	);
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				<DropdownMenuItem
					className="size-8 shrink-0 justify-center rounded-full border border-solid border-border p-0"
					aria-label="Account: User Settings"
					title="User Settings; right-click for its sections"
					onSelect={() => void navigate("/settings/account")}
				>
					<Avatar
						size="sm"
						src={user.avatar_url}
						fallback={user.username}
						// Round, without the avatar's own square frame: the button's circle is its edge
						className="size-6 rounded-full border-0"
					/>
				</DropdownMenuItem>
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="User Settings sections"
				className="z-[2147483647]"
				onContextMenu={(event) => event.stopPropagation()}
			>
				{sections.map(([path, { label, icon: Icon }]) => (
					<ContextMenuItem
						key={path}
						onSelect={() => void navigate(`/settings/${path}`)}
					>
						<Icon aria-hidden />
						{label}
					</ContextMenuItem>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
};
