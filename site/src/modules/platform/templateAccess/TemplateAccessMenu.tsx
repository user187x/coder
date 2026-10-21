import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	setTemplateAccessList,
	templateAccessList,
} from "#/api/queries/templates";
import { users as usersQuery } from "#/api/queries/users";
import type { Template, User } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
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

/**
 * Platform: who may see and use a template (the Templates table's Access column, for those who may edit it): a menu
 * with a search over every account and a tick for each one on the template's access list. A pick is saved at once
 * and restricts the template to those picked; unticking the last one leaves it locked down (its editors only) until
 * "Allow everyone". The template's editors (owners, template admins) always may - they set the list. Coder's own
 * template permissions are a Premium feature: this list is the platform's (the fork's /templates/{id}/access), also
 * set in the template's settings (TemplatePermissionsCard).
 */
export const TemplateAccessMenu: React.FC<{ template: Template }> = ({
	template,
}) => {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const list = useQuery(templateAccessList(template.id));
	const accounts = useQuery({
		...usersQuery({ limit: 1000 }),
		enabled: open,
	});
	const save = useMutation({
		...setTemplateAccessList(queryClient, template.id),
		onError: (error) => toast.error(getErrorMessage(error, "Not changed.")),
	});
	const chosen = new Set(list.data?.user_ids ?? []);
	const everyone = !list.data?.restricted;
	const name = template.display_name || template.name;

	const toggle = (user: User) => {
		const next = new Set(chosen);
		if (next.has(user.id)) {
			next.delete(user.id);
		} else {
			next.add(user.id);
		}
		save.mutate({ user_ids: [...next], restricted: true });
	};

	// the users on the list first, then the others, each by name
	const people = [...(accounts.data?.users ?? [])]
		.filter((u) => u.status !== "suspended" || chosen.has(u.id))
		.sort(
			(a, b) =>
				Number(chosen.has(b.id)) - Number(chosen.has(a.id)) ||
				a.username.localeCompare(b.username),
		);
	const picked = (accounts.data?.users ?? []).filter((u) => chosen.has(u.id));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					data-testid={`template-access-${template.name}`}
					aria-label={`Who can see and use ${name}`}
					className="gap-1.5 transition-none group-hover:border-border-secondary"
					onClick={(e) => e.stopPropagation()}
					disabled={list.isLoading || list.isError}
				>
					<UsersIcon aria-hidden />
					<span className="tabular-nums">
						{list.isError
							? "Unknown"
							: everyone
								? "Everyone"
								: chosen.size === 0
									? "Admins only"
									: `${chosen.size} ${chosen.size === 1 ? "user" : "users"}`}
					</span>
					<ChevronDownIcon aria-hidden className="text-content-secondary" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-80 p-0"
				onClick={(e) => e.stopPropagation()}
				data-testid="template-access-menu"
			>
				<div className="border-0 border-b border-solid border-border px-3 py-2.5">
					<div className="text-sm font-semibold text-content-primary">
						Who can see and use {name}
					</div>
					<div className="text-xs text-content-secondary">
						{everyone
							? "Everyone. Pick users to allow only them."
							: chosen.size === 0
								? "Locked down: template admins only. Pick users to let them in."
								: `Only ${picked.map((u) => u.username).join(", ") || `${chosen.size} users`} - and template admins.`}
					</div>
				</div>
				<Command>
					<CommandInput placeholder="Search users…" />
					<CommandList className="max-h-72">
						<CommandEmpty>
							{accounts.isLoading ? "Loading users…" : "No user matches."}
						</CommandEmpty>
						<CommandGroup>
							{people.map((user) => {
								const on = chosen.has(user.id);
								return (
									<CommandItem
										key={user.id}
										value={`${user.username} ${user.name ?? ""} ${user.email}`}
										onSelect={() => toggle(user)}
										data-testid={`template-access-user-${user.username}`}
										data-checked={on || undefined}
										className="gap-2"
									>
										<span
											aria-hidden
											className={cn(
												"flex size-4 shrink-0 items-center justify-center rounded border border-solid",
												on
													? "border-content-link bg-content-link text-surface-primary"
													: "border-border-secondary",
											)}
										>
											{on && <CheckIcon className="size-3" />}
										</span>
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
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
				<div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-border px-3 py-2">
					<span className="text-xs text-content-secondary">
						{save.isPending ? "Saving…" : "Saved as you pick."}
					</span>
					<Button
						variant="subtle"
						size="sm"
						disabled={everyone || save.isPending}
						onClick={() => save.mutate({ user_ids: [], restricted: false })}
						data-testid="template-access-everyone"
					>
						Allow everyone
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
};
