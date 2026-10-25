import {
	ActivityIcon,
	EllipsisVerticalIcon,
	KeyRoundIcon,
	LayoutGridIcon,
	PencilIcon,
	TrashIcon,
	UserCheckIcon,
	UserXIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { User } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import type { UserAdminAction } from "./UserActionDialogs";

type UserMoreActionsProps = {
	user: User;
	me: string;
	onAction: (action: UserAdminAction) => void;
	canViewActivity?: boolean;
	oidcRoleSyncEnabled?: boolean;
};

export const UserMoreActions: React.FC<UserMoreActionsProps> = ({
	user,
	me,
	onAction,
	canViewActivity,
	oidcRoleSyncEnabled,
}) => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					size="icon-lg"
					variant="subtle"
					type="button"
					aria-label="Open menu"
				>
					<EllipsisVerticalIcon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem asChild>
					<Link
						to={`/workspaces?filter=${encodeURIComponent(`owner:${user.username}`)}`}
					>
						<LayoutGridIcon aria-hidden />
						Workspaces
					</Link>
				</DropdownMenuItem>

				{canViewActivity && (
					<DropdownMenuItem asChild>
						<Link
							to={`/audit?filter=${encodeURIComponent(`username:${user.username}`)}`}
						>
							<ActivityIcon aria-hidden />
							View activity
						</Link>
					</DropdownMenuItem>
				)}

				<DropdownMenuItem
					onClick={() =>
						onAction({
							type: "edit",
							user,
							rolesReadOnly: user.login_type === "oidc" && oidcRoleSyncEnabled,
						})
					}
				>
					<PencilIcon aria-hidden />
					Edit
				</DropdownMenuItem>

				{user.status !== "suspended" && (
					<DropdownMenuItem
						disabled={user.login_type !== "password"}
						onClick={() => onAction({ type: "resetPassword", user })}
					>
						<KeyRoundIcon aria-hidden />
						Password Reset
					</DropdownMenuItem>
				)}

				{user.status === "active" || user.status === "dormant" ? (
					<DropdownMenuItem onClick={() => onAction({ type: "suspend", user })}>
						<UserXIcon aria-hidden />
						Suspend
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem
						onClick={() => onAction({ type: "activate", user })}
					>
						<UserCheckIcon aria-hidden />
						Activate&hellip;
					</DropdownMenuItem>
				)}

				<DropdownMenuSeparator />

				<DropdownMenuItem
					className="text-content-destructive focus:text-content-destructive"
					onClick={() => {
						if (user.id !== me) onAction({ type: "delete", user });
					}}
					disabled={user.id === me}
				>
					<TrashIcon aria-hidden className="size-icon-xs" />
					Delete&hellip;
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
