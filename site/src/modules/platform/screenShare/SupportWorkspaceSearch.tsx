import { CheckIcon, SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { MonitoringOverview } from "#/api/platform";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/Command/Command";
import { useAuthContext } from "#/contexts/auth/AuthProvider";

export const SupportWorkspaceSearch = ({
	overview,
	value,
	onChange,
	disabled,
}: {
	overview?: MonitoringOverview;
	value: string;
	onChange: (id: string) => void;
	disabled: boolean;
}) => {
	const [search, setSearch] = useState("");
	const [open, setOpen] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const { user: me } = useAuthContext();
	// The workspace owner shares with the admin requesting, so a support session with oneself cannot start.
	const workspaces =
		overview?.users.flatMap(({ user, instances }) =>
			user.id === me?.id
				? []
				: instances.map((workspace) => ({ user, workspace })),
		) ?? [];
	const selected = workspaces.find(
		({ workspace }) => workspace.workspaceId === value,
	);
	const query = search.trim().toLowerCase();
	const matches = workspaces.filter(({ user, workspace }) =>
		`${user.username}/${workspace.name} ${user.name} ${user.email}`
			.toLowerCase()
			.includes(query),
	);
	return (
		<Command
			label="Search workspaces or users"
			shouldFilter={false}
			className="vhs-search relative h-auto min-w-48 flex-1 overflow-visible border border-solid border-border"
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
			}}
		>
			{/* A VCR's tape door over the field: it swings in on its top hinge when the search takes focus. */}
			<button
				type="button"
				tabIndex={-1}
				aria-hidden
				data-open={open || undefined}
				className="vhs-door"
				disabled={disabled || !overview}
				onClick={() => input.current?.focus()}
			>
				<SearchIcon className="size-4 shrink-0" />
				<span className="truncate">
					{selected
						? `${selected.user.username}/${selected.workspace.name}`
						: "Search workspaces or users"}
				</span>
			</button>
			<CommandInput
				ref={input}
				className="text-center"
				aria-label="Search workspaces or users"
				placeholder="Search workspaces or users…"
				disabled={disabled || !overview}
				value={
					open
						? search
						: selected
							? `${selected.user.username}/${selected.workspace.name}`
							: search
				}
				onFocus={() => {
					setSearch("");
					setOpen(true);
				}}
				onValueChange={(text) => {
					setSearch(text);
					setOpen(true);
					onChange("");
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						setOpen(false);
					}
					if (event.key === "ArrowDown") setOpen(true);
				}}
			/>
			<CommandList
				aria-label="Matching workspaces"
				hidden={!open}
				className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 rounded-md border border-solid border-border bg-surface-primary p-1 shadow-lg"
			>
				<CommandEmpty>No matching workspaces.</CommandEmpty>
				{matches.map(({ user, workspace }) => (
					<CommandItem
						key={workspace.workspaceId}
						value={workspace.workspaceId}
						aria-label={`${user.username}/${workspace.name}`}
						className="cursor-pointer gap-3"
						onSelect={() => {
							onChange(workspace.workspaceId);
							setSearch("");
							setOpen(false);
						}}
					>
						<Avatar src={user.avatar_url} fallback={user.username} />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-content-primary">
								{user.username}/{workspace.name}
							</span>
							<span className="truncate text-xs text-content-secondary">
								{user.name || user.username} · {user.email}
							</span>
						</span>
						{value === workspace.workspaceId && <CheckIcon aria-hidden />}
					</CommandItem>
				))}
			</CommandList>
		</Command>
	);
};
