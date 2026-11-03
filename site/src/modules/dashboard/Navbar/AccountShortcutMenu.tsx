import {
	ImageIcon,
	KeyRoundIcon,
	LogOutIcon,
	UserRoundIcon,
	UserRoundPenIcon,
} from "lucide-react";
import { useNavigate } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { openAvatarDialog } from "#/modules/platform/avatar/avatarDialogStore";

/** Account shortcuts reuse the authenticated profile and picture editors. */
export const AccountShortcutMenu = ({
	children,
	onSignOut,
}: {
	children: React.ReactElement;
	onSignOut: () => void;
}) => {
	const navigate = useNavigate();
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (
						event.key !== "ContextMenu" &&
						!(event.shiftKey && event.key === "F10")
					)
						return;
					event.preventDefault();
					event.stopPropagation();
					const box = event.currentTarget.getBoundingClientRect();
					event.currentTarget.dispatchEvent(
						new MouseEvent("contextmenu", {
							bubbles: true,
							cancelable: true,
							clientX: box.right,
							clientY: box.bottom,
						}),
					);
				}}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="Account actions"
				className="z-[2147483647]"
				onContextMenu={(event) => event.stopPropagation()}
			>
				<ContextMenuItem onSelect={() => void navigate("/settings/account")}>
					<UserRoundIcon />
					View account
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => void navigate("/settings/security")}>
					<KeyRoundIcon />
					Set password
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => void navigate("/settings/account?edit=username")}
				>
					<UserRoundPenIcon />
					Set user name
				</ContextMenuItem>
				<ContextMenuItem onSelect={openAvatarDialog}>
					<ImageIcon />
					Set picture
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={onSignOut}>
					<LogOutIcon />
					Sign Out
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};
