import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	setTemplateAccessList,
	templateAccessList,
} from "#/api/queries/templates";
import { users as usersQuery } from "#/api/queries/users";
import type { Template, User } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/Command/Command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import {
	AddPersonGlyph,
	LockGlyph,
	PlusGlyph,
	TrashGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	PressSwitch,
} from "#/modules/platform/settingsPage/settingsParts";

/**
 * Platform: the template settings' Permissions card where Coder's template permissions are not available (a Premium
 * feature; this build is the open-source one): the template's lock down - off, everyone may see and use it; on, only
 * the members listed and its admins - kept in the platform's access list (the fork's /templates/{id}/access, the
 * same one the Templates table's Access menu sets). Each change is saved at once, as Coder's own card does.
 */
export const TemplateLockdown: React.FC<{
	template: Template;
	canUpdate: boolean;
}> = ({ template, canUpdate }) => {
	const queryClient = useQueryClient();
	const list = useQuery({
		...templateAccessList(template.id),
		enabled: canUpdate,
	});
	const accounts = useQuery({
		...usersQuery({ limit: 1000 }),
		enabled: canUpdate,
	});
	const save = useMutation({
		...setTemplateAccessList(queryClient, template.id),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Not changed."), {
				description: getErrorDetail(error),
			}),
	});

	if (!canUpdate) {
		return (
			<p className="m-0 p-6 text-[13px] text-(--ws-muted)">
				Only those who can update this template see and change who may use it.
			</p>
		);
	}
	if (!list.data) {
		return <CardLoader />;
	}

	const locked = list.data.restricted;
	const chosen = new Set(list.data.user_ids);
	const members = (accounts.data?.users ?? []).filter((u) => chosen.has(u.id));
	const set = (restricted: boolean, ids: Iterable<string>) =>
		save.mutate({ user_ids: restricted ? [...ids] : [], restricted });

	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex items-center gap-3.5">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-(--ws-r-bar) bg-(--ws-raised) text-(--ws-muted)">
					<LockGlyph />
				</div>
				<div className="min-w-0 flex-1">
					<div id="tpl-lockdown-label" className="font-semibold">
						Lock down this template
					</div>
					<p
						id="tpl-lockdown-help"
						className="m-0 text-[13px] text-(--ws-muted)"
					>
						{locked
							? "Only the members below and the template's admins can see it and create workspaces from it."
							: "Everyone in the organization can see it and create workspaces from it."}
					</p>
				</div>
				<PressSwitch
					pressed={locked}
					onChange={(on) => set(on, chosen)}
					disabled={save.isPending}
					labelledBy="tpl-lockdown-label"
					describedBy="tpl-lockdown-help"
					testId="template-lockdown-switch"
				/>
			</div>
			{locked && (
				<>
					<div className="flex justify-end">
						<AddMember
							users={(accounts.data?.users ?? []).filter(
								(u) => !chosen.has(u.id) && u.status !== "suspended",
							)}
							loading={accounts.isLoading}
							disabled={save.isPending}
							onAdd={(user) => set(true, [...chosen, user.id])}
						/>
					</div>
					{members.length === 0 && chosen.size === 0 ? (
						<div className="flex flex-col items-center gap-2.5 rounded-(--ws-r-lg) border border-dashed border-(--ws-raised-line) px-5 py-10 text-center">
							<div className="flex size-12 items-center justify-center rounded-(--ws-r-bar) bg-(--ws-raised) text-(--ws-muted)">
								<AddPersonGlyph />
							</div>
							<div className="font-semibold">No members yet</div>
							<p className="m-0 max-w-[340px] text-[13px] text-(--ws-muted)">
								Only the template's admins can use it. Add the members who may.
							</p>
						</div>
					) : (
						<ul
							className="m-0 list-none rounded-(--ws-r-lg) border border-solid border-(--ws-line) bg-(--ws-well) p-0"
							aria-label="Members"
							data-testid="template-lockdown-members"
						>
							{members.map((user) => (
								<li
									key={user.id}
									className="flex items-center gap-3 border-0 border-b border-solid border-(--ws-row-line) px-4 py-3 last:border-b-0"
								>
									<Avatar
										size="lg"
										fallback={user.username}
										src={user.avatar_url}
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate font-medium">{user.username}</div>
										{user.name && (
											<div className="truncate text-[13px] text-(--ws-muted)">
												{user.name}
											</div>
										)}
									</div>
									<span className="text-(--ws-text-3)">Use</span>
									<button
										type="button"
										className="ws-btn ws-btn-icon ws-hit"
										aria-label={`Remove ${user.username}`}
										title="Remove"
										disabled={save.isPending}
										onClick={() =>
											set(
												true,
												[...chosen].filter((id) => id !== user.id),
											)
										}
									>
										<TrashGlyph />
									</button>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);
};

/** "Add member": a search over the accounts not yet listed; a pick adds it at once. */
const AddMember: React.FC<{
	users: User[];
	loading: boolean;
	disabled: boolean;
	onAdd: (user: User) => void;
}> = ({ users, loading, disabled, onAdd }) => {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="ws-btn ws-btn-lg"
					disabled={disabled}
					data-testid="template-lockdown-add"
				>
					<PlusGlyph />
					Add member
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<Command>
					<CommandInput placeholder="Search users…" />
					<CommandList className="max-h-72">
						<CommandEmpty>
							{loading ? "Loading users…" : "No user matches."}
						</CommandEmpty>
						<CommandGroup>
							{[...users]
								.sort((a, b) => a.username.localeCompare(b.username))
								.map((user) => (
									<CommandItem
										key={user.id}
										value={`${user.username} ${user.name ?? ""} ${user.email}`}
										onSelect={() => {
											setOpen(false);
											onAdd(user);
										}}
										data-testid={`template-lockdown-user-${user.username}`}
										className="gap-2"
									>
										<Avatar
											size="sm"
											src={user.avatar_url}
											fallback={user.username}
										/>
										<span className="min-w-0 flex-1 truncate">
											{user.username}
											{user.name && (
												<span className="ml-1.5 text-content-secondary">
													{user.name}
												</span>
											)}
										</span>
									</CommandItem>
								))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
};
