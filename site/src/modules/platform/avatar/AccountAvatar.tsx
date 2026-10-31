import { PencilIcon } from "lucide-react";
import type { User } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { openAvatarDialog } from "./avatarDialogStore";

type AccountAvatarProps = {
	user: User;
};

/**
 * Settings > Account: your avatar, large, as Coder shows you everywhere (your
 * uploaded picture, else Coder's own (OIDC) picture, else the default avatar,
 * else your initials). A click opens the avatar dialog to change it.
 */
export const AccountAvatar: React.FC<AccountAvatarProps> = ({ user }) => {
	const label = user.name || user.username;

	return (
		<div className="mb-8 flex items-center gap-5">
			<button
				type="button"
				onClick={openAvatarDialog}
				aria-label="Change your avatar"
				title="Change your avatar"
				className="group relative size-24 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-content-link focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
			>
				<Avatar
					src={user.avatar_url}
					fallback={user.username}
					className="size-full rounded-full text-2xl font-semibold [&_img]:object-cover"
					style={{ padding: 0 }}
				/>
				<span
					aria-hidden
					className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border border-solid border-border bg-surface-primary text-content-primary shadow-md transition-colors group-hover:bg-surface-secondary"
				>
					<PencilIcon className="size-icon-sm" />
				</span>
			</button>
			<div className="flex min-w-0 flex-col gap-1">
				<div className="truncate">
					<strong className="text-base text-content-primary">{label}</strong>
					{user.name && (
						<span className="text-content-secondary"> @{user.username}</span>
					)}
				</div>
				<div className="text-sm text-content-secondary">
					Click the picture to change it. It shows wherever Coder shows you.
				</div>
			</div>
		</div>
	);
};
