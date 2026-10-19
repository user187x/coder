import { useState } from "react";
import { useQuery } from "react-query";
import { workspaceSharingSettings } from "#/api/queries/organizations";
import type { Workspace, WorkspaceRole } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { getGroupSubtitle, isGroup } from "#/modules/groups";
import {
	AddPersonGlyph,
	PeopleGlyph,
	PlusGlyph,
	SearchGlyph,
	TrashGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	SettingsCard,
} from "#/modules/platform/settingsPage/settingsParts";
import {
	UserOrGroupAutocomplete,
	type UserOrGroupAutocompleteValue,
} from "#/modules/workspaces/WorkspaceSharingForm/UserOrGroupAutocomplete";
import { useWorkspaceSharing } from "#/modules/workspaces/WorkspaceSharingForm/useWorkspaceSharing";
import { RoleSelect } from "#/modules/workspaces/WorkspaceSharingForm/WorkspaceSharingForm";

/** A member of the workspace's sharing: who, their role (changed or removed at once, for those who may). */
const MemberRow: React.FC<{
	name: string;
	subtitle: string | undefined;
	avatar: string | undefined;
	role: WorkspaceRole;
	canUpdate: boolean;
	updating: boolean;
	onRole: (role: WorkspaceRole) => void;
	onRemove: () => void;
}> = ({
	name,
	subtitle,
	avatar,
	role,
	canUpdate,
	updating,
	onRole,
	onRemove,
}) => (
	<li className="flex items-center gap-3 border-0 border-b border-solid border-(--ws-row-line) px-4 py-3 last:border-b-0">
		<Avatar size="lg" fallback={name} src={avatar} />
		<div className="min-w-0 flex-1">
			<div className="truncate font-medium">{name}</div>
			{subtitle && (
				<div className="truncate text-[13px] text-(--ws-muted)">{subtitle}</div>
			)}
		</div>
		{canUpdate ? (
			<>
				<RoleSelect value={role} disabled={updating} onValueChange={onRole} />
				<button
					type="button"
					className="ws-btn ws-btn-icon ws-hit"
					aria-label={`Remove ${name}`}
					title="Remove"
					onClick={onRemove}
				>
					<TrashGlyph />
				</button>
			</>
		) : (
			<span className="capitalize text-(--ws-text-3)">{role}</span>
		)}
	</li>
);

/**
 * Sharing: other users and groups who may use or administer the workspace. Adding, changing a role and removing take
 * effect at once (not through the save bar), as they always have; only those who may update the workspace change it.
 */
export const SharingCard: React.FC<{
	workspace: Workspace;
	canUpdate: boolean;
}> = ({ workspace, canUpdate }) => {
	const sharing = useWorkspaceSharing(workspace);
	const settings = useQuery(
		workspaceSharingSettings(workspace.organization_id),
	);
	const [chosen, setChosen] = useState<UserOrGroupAutocompleteValue>(null);
	const [role, setRole] = useState<WorkspaceRole>("use");
	const acl = sharing.workspaceACL;
	const adding = sharing.isAddingUser || sharing.isAddingGroup;
	const error = sharing.error ?? sharing.mutationError;
	const empty = acl && acl.users.length === 0 && acl.group.length === 0;

	const add = () => {
		if (!chosen) {
			return;
		}
		const reset = () => {
			setChosen(null);
			setRole("use");
		};
		if (isGroup(chosen)) {
			sharing.addGroup(chosen, role, reset);
		} else {
			sharing.addUser({ ...chosen, role }, role, reset);
		}
	};

	return (
		<SettingsCard
			id="sharing"
			title="Sharing"
			description="Give other users and groups access"
			icon={<PeopleGlyph size={18} />}
		>
			{settings.isLoading ? (
				<CardLoader />
			) : settings.data?.sharing_disabled ? (
				<p className="m-0 p-6 text-[13px] text-(--ws-muted)">
					This workspace cannot be shared: workspace sharing has been disabled
					for this organization.
				</p>
			) : (
				<div className="flex flex-col gap-4 p-6">
					{(Boolean(error) || settings.error) && (
						<ErrorAlert error={error ?? settings.error} />
					)}
					{canUpdate && (
						<div className="flex flex-wrap gap-2">
							<div className="relative min-w-0 flex-[999_1_260px]">
								<SearchGlyph className="pointer-events-none absolute left-3.5 top-3.5 z-10 text-(--ws-faint)" />
								<label htmlFor="share-search" className="sr-only">
									Search for user or group
								</label>
								<UserOrGroupAutocomplete
									id="share-search"
									inlineSearch
									placeholder="Search for a user or group"
									organizationId={workspace.organization_id}
									value={chosen}
									exclude={acl ? [...acl.group, ...acl.users] : []}
									onChange={setChosen}
									className="ws-input ws-input-search"
								/>
							</div>
							<label htmlFor="share-role" className="sr-only">
								Role
							</label>
							<Select
								value={role}
								onValueChange={(value) => setRole(value as WorkspaceRole)}
								disabled={adding}
							>
								<SelectTrigger
									id="share-role"
									className="ws-input ws-select max-w-40 flex-[1_1_120px]"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="use">Use</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
								</SelectContent>
							</Select>
							<button
								type="button"
								className="ws-btn ws-btn-lg"
								disabled={!chosen || adding}
								onClick={add}
							>
								{adding ? <Spinner loading size="sm" /> : <PlusGlyph />}
								Add member
							</button>
						</div>
					)}
					{sharing.hasRemovedMember && (
						<p className="m-0 text-[13px] text-content-warning">
							Workspace restart required for the removal to take effect.
						</p>
					)}
					{!acl ? (
						<CardLoader />
					) : empty ? (
						<div className="flex flex-col items-center gap-2.5 rounded-(--ws-r-lg) border border-dashed border-(--ws-raised-line) px-5 py-10 text-center">
							<div className="flex size-12 items-center justify-center rounded-(--ws-r-bar) bg-(--ws-raised) text-(--ws-muted)">
								<AddPersonGlyph />
							</div>
							<div className="font-semibold">Not shared with anyone yet</div>
							<p className="m-0 max-w-[340px] text-[13px] text-(--ws-muted)">
								{canUpdate
									? "Search for a user or group above, choose a role, and add them."
									: "Only those who can update this workspace share it."}
							</p>
						</div>
					) : (
						<ul
							className="m-0 list-none rounded-(--ws-r-lg) border border-solid border-(--ws-line) bg-(--ws-well) p-0"
							aria-label="Shared with"
						>
							{acl.group.map((group) => (
								<MemberRow
									key={group.id}
									name={group.display_name || group.name}
									subtitle={getGroupSubtitle(group)}
									avatar={group.avatar_url}
									role={group.role}
									canUpdate={canUpdate}
									updating={sharing.updatingGroupId === group.id}
									onRole={(value) => sharing.updateGroup(group, value)}
									onRemove={() => sharing.removeGroup(group)}
								/>
							))}
							{acl.users.map((user) => (
								<MemberRow
									key={user.id}
									name={user.username}
									subtitle={user.name}
									avatar={user.avatar_url}
									role={user.role}
									canUpdate={canUpdate}
									updating={sharing.updatingUserId === user.id}
									onRole={(value) => sharing.updateUser(user, value)}
									onRemove={() => sharing.removeUser(user)}
								/>
							))}
						</ul>
					)}
				</div>
			)}
		</SettingsCard>
	);
};
