import { UsersIcon } from "lucide-react";
import { type ChatPeer, isChatGroupId } from "#/api/platform";
import {
	resolvePlatformAvatar,
	usePlatformSnapshot,
} from "#/contexts/platformBoot";
import { displayName } from "./chatStore";

type ChatAvatarProps = {
	peer: Pick<ChatPeer, "username" | "name"> & { id?: string };
};

/** The picture Coder shows for this user (uploaded or default), else initials; a group chat's sign. */
export const ChatAvatar: React.FC<ChatAvatarProps> = ({ peer }) => {
	const platform = usePlatformSnapshot();
	if (peer.id && isChatGroupId(peer.id)) {
		return (
			<span
				aria-hidden
				className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-content-secondary"
			>
				<UsersIcon className="size-3.5" />
			</span>
		);
	}
	const src = resolvePlatformAvatar(platform, peer.username, undefined);
	const initials =
		displayName(peer)
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase() || "?";

	return (
		<span
			aria-hidden
			className="flex size-[26px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-tertiary text-[11px] font-semibold text-content-secondary"
		>
			{src ? (
				<img src={src} alt="" className="block size-full object-cover" />
			) : (
				initials
			)}
		</span>
	);
};
