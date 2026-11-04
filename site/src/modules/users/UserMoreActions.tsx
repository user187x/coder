import {
	ActivityIcon,
	CloudIcon,
	EllipsisVerticalIcon,
	KeyRoundIcon,
	LayoutGridIcon,
	ListChecksIcon,
	PencilIcon,
	ShieldIcon,
	TrashIcon,
	UserCheckIcon,
	UserXIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { authMethods } from "#/api/queries/users";
import type { User } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ClientCertificatesDialog } from "#/modules/platform/clientCertificates/ClientCertificatesDialog";
import { AccountCloudDriveConnections } from "#/modules/platform/cloudDrive/AccountCloudDriveConnections";
import { QuotaAdjustments } from "#/modules/platform/quotaRequests/QuotaAdjustments";
import { AccountLockdownDialog } from "./AccountLockdownDialog";
import type { UserAdminAction } from "./UserActionDialogs";

type UserMoreActionsProps = {
	user: User;
	me: string;
	onAction: (action: UserAdminAction) => void;
	canViewActivity?: boolean;
	canManageWorkspaces?: boolean;
	oidcRoleSyncEnabled?: boolean;
};

export const UserMoreActions: React.FC<UserMoreActionsProps> = ({
	user,
	me,
	onAction,
	canViewActivity,
	canManageWorkspaces,
	oidcRoleSyncEnabled,
}) => {
	const { data: methods } = useQuery({
		...authMethods(),
		enabled: user.login_type === "oidc",
	});
	const provider = methods?.oidc.accountUrl;
	const passwordURL = provider && new URL(provider);
	if (passwordURL && me !== user.id) {
		const [prefix, realmPath] = passwordURL.pathname.split("/realms/");
		const realm = realmPath?.split("/")[0];
		if (realm) {
			passwordURL.pathname = `${prefix}/admin/${realm}/console/`;
			passwordURL.hash = `/${realm}/users`;
		}
	}
	const [lockdownOpen, setLockdownOpen] = useState(false);
	const [quotaOpen, setQuotaOpen] = useState(false);
	const [driveOpen, setDriveOpen] = useState(false);
	const [certificatesOpen, setCertificatesOpen] = useState(false);
	return (
		<>
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
							All workspaces
						</Link>
					</DropdownMenuItem>
					{canManageWorkspaces && (
						<>
							<DropdownMenuItem onSelect={() => setQuotaOpen(true)}>
								<ListChecksIcon aria-hidden /> Quota Requests
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => setDriveOpen(true)}>
								<CloudIcon aria-hidden /> Cloud Drive
							</DropdownMenuItem>
						</>
					)}

					<DropdownMenuItem onSelect={() => setLockdownOpen(true)}>
						<ShieldIcon aria-hidden />
						Lock Down
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
								rolesReadOnly:
									user.login_type === "oidc" && oidcRoleSyncEnabled,
							})
						}
					>
						<PencilIcon aria-hidden />
						Edit
					</DropdownMenuItem>

					{user.status !== "suspended" &&
						(user.login_type === "oidc" && passwordURL ? (
							<DropdownMenuItem asChild>
								<a href={passwordURL.href} target="_blank" rel="noreferrer">
									<KeyRoundIcon />
									Manage password in Keycloak
								</a>
							</DropdownMenuItem>
						) : user.id === me && user.login_type === "password" ? (
							<DropdownMenuItem asChild>
								<Link to="/settings/security">
									<KeyRoundIcon />
									Change password
								</Link>
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem
								disabled={user.login_type !== "password"}
								onClick={() => onAction({ type: "resetPassword", user })}
							>
								<KeyRoundIcon aria-hidden />
								Password Reset
							</DropdownMenuItem>
						))}

					{user.status === "active" || user.status === "dormant" ? (
						<DropdownMenuItem
							onClick={() => onAction({ type: "suspend", user })}
						>
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

					{user.login_type === "oidc" && (
						<DropdownMenuItem onSelect={() => setCertificatesOpen(true)}>
							<KeyRoundIcon aria-hidden /> Client certificates
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
			{canManageWorkspaces && quotaOpen && (
				<QuotaAdjustments
					user={user}
					open={quotaOpen}
					onOpenChange={setQuotaOpen}
				/>
			)}
			{canManageWorkspaces && driveOpen && (
				<AccountCloudDriveConnections
					user={user}
					open={driveOpen}
					onOpenChange={setDriveOpen}
				/>
			)}
			{certificatesOpen && (
				<ClientCertificatesDialog
					user={user}
					onClose={() => setCertificatesOpen(false)}
				/>
			)}
			{lockdownOpen && (
				<AccountLockdownDialog
					user={user}
					open={lockdownOpen}
					onOpenChange={setLockdownOpen}
				/>
			)}
		</>
	);
};
