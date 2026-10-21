import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	setGroupRole,
	setUserRole,
	templateACL,
} from "#/api/queries/templates";
import type {
	Group,
	ReducedUser,
	Template,
	TemplateRole,
} from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import { getGroupSubtitle, isGroup } from "#/modules/groups";
import {
	AddPersonGlyph,
	PlusGlyph,
	SearchGlyph,
	ShieldGlyph,
	TrashGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	SettingsCard,
} from "#/modules/platform/settingsPage/settingsParts";
import { TemplateLockdown } from "#/modules/platform/templateAccess/TemplateLockdown";
import {
	UserOrGroupAutocomplete,
	type UserOrGroupAutocompleteValue,
} from "../TemplatePermissionsPage/UserOrGroupAutocomplete";

const failed = (what: string) => (error: unknown) =>
	toast.error(getErrorMessage(error, what), {
		description: getErrorDetail(error),
	});

/** A member's role: Use, or Admin (changes the template itself). */
const RoleSelect: React.FC<{
	value: TemplateRole;
	disabled?: boolean;
	onValueChange: (value: TemplateRole) => void;
	label: string;
}> = ({ value, disabled, onValueChange, label }) => (
	<Select
		value={value}
		disabled={disabled}
		onValueChange={(next) => onValueChange(next as TemplateRole)}
	>
		<SelectTrigger
			className="ws-input ws-input-sm ws-select ws-hit w-32"
			aria-label={label}
		>
			<SelectValue>
				<span className="capitalize">{value}</span>
			</SelectValue>
		</SelectTrigger>
		<SelectContent>
			<SelectItem value="use" className="w-[250px] flex-col items-start py-2">
				<div className="text-content-primary">Use</div>
				<div className="text-xs leading-[140%] text-content-secondary">
					Can read and use this template to create workspaces.
				</div>
			</SelectItem>
			<SelectItem value="admin" className="w-[250px] flex-col items-start py-2">
				<div className="text-content-primary">Admin</div>
				<div className="text-xs leading-[140%] text-content-secondary">
					Can modify all aspects of this template including permissions,
					metadata, and template versions.
				</div>
			</SelectItem>
		</SelectContent>
	</Select>
);

const MemberRow: React.FC<{
	name: string;
	subtitle: string | undefined;
	avatar: string | undefined;
	role: TemplateRole;
	canUpdate: boolean;
	updating: boolean;
	onRole: (role: TemplateRole) => void;
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
				<RoleSelect
					value={role}
					disabled={updating}
					onValueChange={onRole}
					label={`${name}'s role`}
				/>
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
 * Permissions: who may use the template, or administer it. Adding, changing a role and removing take effect at once
 * (not through the save bar), as on the former Permissions page. Platform: without Coder's template permissions (a
 * Premium feature; the platform runs the open-source build), the template's lock down instead (TemplateLockdown).
 */
export const TemplatePermissionsCard: React.FC<{
	template: Template;
	canUpdate: boolean;
}> = ({ template, canUpdate }) => {
	const { template_rbac: rbac } = useFeatureVisibility();
	const queryClient = useQueryClient();
	const acl = useQuery({ ...templateACL(template.id), enabled: rbac }).data;
	const userRole = useMutation(setUserRole(queryClient));
	const groupRole = useMutation(setGroupRole(queryClient));
	const [chosen, setChosen] = useState<UserOrGroupAutocompleteValue>(null);
	const [role, setRole] = useState<TemplateRole>("use");
	const adding = userRole.isPending || groupRole.isPending;
	const empty = acl && acl.users.length === 0 && acl.group.length === 0;
	const groupName = (g: Group) => g.display_name || g.name;

	const add = async () => {
		if (!chosen) {
			return;
		}
		try {
			if (isGroup(chosen)) {
				await groupRole.mutateAsync({
					templateId: template.id,
					groupId: chosen.id,
					role,
				});
			} else {
				await userRole.mutateAsync({
					templateId: template.id,
					userId: (chosen as ReducedUser).id,
					role,
				});
			}
			setChosen(null);
			setRole("use");
		} catch (error) {
			failed("The member could not be added.")(error);
		}
	};

	return (
		<SettingsCard
			id="permissions"
			title="Permissions"
			description={
				rbac
					? "Which members and groups can use this template"
					: "Lock it down to the members who may use it"
			}
			icon={<ShieldGlyph size={18} />}
		>
			{!rbac ? (
				<TemplateLockdown template={template} canUpdate={canUpdate} />
			) : (
				<div className="flex flex-col gap-4 p-6">
					{canUpdate && (
						<div className="flex flex-wrap gap-2">
							<div className="relative min-w-0 flex-[999_1_260px]">
								<SearchGlyph className="pointer-events-none absolute left-3.5 top-3.5 z-10 text-(--ws-faint)" />
								<label htmlFor="tpl-acl-search" className="sr-only">
									Search for user or group
								</label>
								<UserOrGroupAutocomplete
									id="tpl-acl-search"
									inlineSearch
									placeholder="Search for a user or group"
									templateID={template.id}
									value={chosen}
									exclude={acl ? [...acl.group, ...acl.users] : []}
									onChange={setChosen}
									className="ws-input ws-input-search"
								/>
							</div>
							<label htmlFor="tpl-acl-role" className="sr-only">
								Role
							</label>
							<Select
								value={role}
								onValueChange={(value) => setRole(value as TemplateRole)}
								disabled={adding}
							>
								<SelectTrigger
									id="tpl-acl-role"
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
								onClick={() => void add()}
							>
								{adding ? <Spinner loading size="sm" /> : <PlusGlyph />}
								Add member
							</button>
						</div>
					)}
					{!acl ? (
						<CardLoader />
					) : empty ? (
						<div className="flex flex-col items-center gap-2.5 rounded-(--ws-r-lg) border border-dashed border-(--ws-raised-line) px-5 py-10 text-center">
							<div className="flex size-12 items-center justify-center rounded-(--ws-r-bar) bg-(--ws-raised) text-(--ws-muted)">
								<AddPersonGlyph />
							</div>
							<div className="font-semibold">No members yet</div>
							<p className="m-0 max-w-[340px] text-[13px] text-(--ws-muted)">
								{canUpdate
									? "Search for a user or group above, choose a role, and add them."
									: "Only those who can update this template change who may use it."}
							</p>
						</div>
					) : (
						<ul
							className="m-0 list-none rounded-(--ws-r-lg) border border-solid border-(--ws-line) bg-(--ws-well) p-0"
							aria-label="Members"
						>
							{acl.group.map((group) => (
								<MemberRow
									key={group.id}
									name={groupName(group)}
									subtitle={getGroupSubtitle(group)}
									avatar={group.avatar_url}
									role={group.role}
									canUpdate={canUpdate}
									updating={
										groupRole.isPending &&
										groupRole.variables?.groupId === group.id
									}
									onRole={(next) =>
										groupRole.mutate(
											{
												templateId: template.id,
												groupId: group.id,
												role: next,
											},
											{
												onSuccess: () =>
													toast.success(
														`Role for "${groupName(group)}" updated to "${next}" successfully.`,
													),
												onError: failed(
													`Failed to update role for "${groupName(group)}".`,
												),
											},
										)
									}
									onRemove={() =>
										groupRole.mutate(
											{ templateId: template.id, groupId: group.id, role: "" },
											{
												onSuccess: () =>
													toast.success(
														`Group "${groupName(group)}" removed successfully.`,
													),
												onError: failed(
													`Failed to remove group "${groupName(group)}".`,
												),
											},
										)
									}
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
									updating={
										userRole.isPending && userRole.variables?.userId === user.id
									}
									onRole={(next) =>
										userRole.mutate(
											{ templateId: template.id, userId: user.id, role: next },
											{
												onSuccess: () =>
													toast.success(
														`Role for "${user.username}" updated to "${next}" successfully.`,
													),
												onError: failed(
													`Failed to update role for "${user.username}".`,
												),
											},
										)
									}
									onRemove={() =>
										userRole.mutate(
											{ templateId: template.id, userId: user.id, role: "" },
											{
												onSuccess: () =>
													toast.success(
														`User "${user.username}" removed successfully.`,
													),
												onError: failed(
													`Failed to remove user "${user.username}".`,
												),
											},
										)
									}
								/>
							))}
						</ul>
					)}
				</div>
			)}
		</SettingsCard>
	);
};
