import type { ChatPeer } from "#/api/platform";
import {
	resolvePlatformAvatar,
	usePlatformSnapshot,
} from "#/contexts/platformBoot";
import { displayName } from "./chatStore";

type ChatAvatarProps = {
	peer: Pick<ChatPeer, "username" | "name">;
};

/** The picture Coder shows for this user (uploaded or default), else initials. */
export const ChatAvatar: React.FC<ChatAvatarProps> = ({ peer }) => {
	const platform = usePlatformSnapshot();
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
