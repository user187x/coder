import {
	MessageSquareIcon,
	ShieldIcon,
	Trash2Icon,
	UserXIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { roles } from "#/api/queries/roles";
import { usersQueryKey } from "#/api/queries/users";
import type { User } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { startGroupChat } from "#/modules/platform/chat/chatStore";

type BulkAction = "roles" | "suspend" | "delete";

/** Each user's request, one after another; how many went through and the first error. */
const forEach = async (
	users: readonly User[],
	run: (user: User) => Promise<unknown>,
): Promise<{ done: number; failed: number; error?: string }> => {
	let done = 0;
	let failed = 0;
	let error: string | undefined;
	for (const user of users) {
		try {
			await run(user);
			done++;
		} catch (e) {
			failed++;
			error ??= `${user.username}: ${getErrorMessage(e, "refused")}`;
		}
	}
	return { done, failed, error };
};

const report = (
	verb: string,
	{ done, failed, error }: { done: number; failed: number; error?: string },
) => {
	const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`;
	if (failed === 0) {
		toast.success(`${verb} ${accounts(done)}.`);
	} else {
		toast.error(`${verb} ${accounts(done)}; ${accounts(failed)} not.`, {
			description: error,
		});
	}
};

type BulkUserActionsProps = {
	/** The accounts chosen on this page. */
	selected: readonly User[];
	me: string;
	/** Roles come from the identity provider (OIDC role sync): not edited here. */
	oidcRoleSyncEnabled?: boolean;
	onClear: () => void;
};

/**
 * Admin > Accounts: what to do with every account chosen at once - their roles,
 * suspend them, delete them, or one chat thread with all of them (their first
 * message from you comes up in front of everything for each, once). Your own
 * account is left out of roles, suspension and deletion.
 */
export const BulkUserActions: React.FC<BulkUserActionsProps> = ({
	selected,
	me,
	oidcRoleSyncEnabled,
	onClear,
}) => {
	const queryClient = useQueryClient();
	const [action, setAction] = useState<BulkAction>();
	const [busy, setBusy] = useState(false);
	const others = selected.filter((u) => u.id !== me);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: usersQueryKey });

	const run = async (
		verb: string,
		targets: readonly User[],
		call: (user: User) => Promise<unknown>,
	) => {
		setBusy(true);
		try {
			report(verb, await forEach(targets, call));
			await refresh();
			setAction(undefined);
			onClear();
		} finally {
			setBusy(false);
		}
	};

	const chat = async () => {
		setBusy(true);
		try {
			await startGroupChat(others.map((u) => u.id));
			onClear();
		} catch (e) {
			toast.error(getErrorMessage(e, "The chat could not be started."));
		} finally {
			setBusy(false);
		}
	};

	if (selected.length === 0) {
		return null;
	}
	const suspendable = others.filter((u) => u.status !== "suspended");

	return (
		<div
			className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-solid border-border bg-surface-secondary px-3 py-2"
			role="toolbar"
			aria-label="Accounts chosen"
			data-testid="bulk-user-actions"
		>
			<span className="mr-2 text-sm font-medium">
				{selected.length} {selected.length === 1 ? "account" : "accounts"}{" "}
				chosen
			</span>
			<Button
				size="sm"
				variant="outline"
				disabled={busy || others.length === 0 || oidcRoleSyncEnabled}
				title={
					oidcRoleSyncEnabled
						? "Roles come from your identity provider"
						: undefined
				}
				onClick={() => setAction("roles")}
			>
				<ShieldIcon />
				Edit Roles
			</Button>
			<Button
				size="sm"
				variant="outline"
				disabled={busy || suspendable.length === 0}
				onClick={() => setAction("suspend")}
			>
				<UserXIcon />
				Suspend
			</Button>
			<Button
				size="sm"
				variant="outline"
				disabled={busy || others.length === 0}
				onClick={() => setAction("delete")}
			>
				<Trash2Icon />
				Delete
			</Button>
			<Button
				size="sm"
				variant="outline"
				disabled={busy || others.length === 0}
				onClick={() => void chat()}
			>
				<Spinner loading={busy && !action}>
					<MessageSquareIcon />
				</Spinner>
				Chat
			</Button>
			<Button
				size="sm"
				variant="subtle"
				className="ml-auto"
				onClick={onClear}
				aria-label="Clear the choice"
			>
				<XIcon />
				Clear
			</Button>

			{action === "roles" && (
				<BulkRolesDialog
					users={others}
					busy={busy}
					onClose={() => setAction(undefined)}
					onApply={(add, remove) =>
						run("Updated the roles of", others, (u) => {
							const next = new Set(u.roles.map((r) => r.name));
							for (const r of add) {
								next.add(r);
							}
							for (const r of remove) {
								next.delete(r);
							}
							return API.updateUserRoles([...next], u.id);
						})
					}
				/>
			)}

			<ConfirmDialog
				type="delete"
				hideCancel={false}
				open={action === "suspend"}
				confirmLoading={busy}
				title={`Suspend ${suspendable.length} ${suspendable.length === 1 ? "account" : "accounts"}`}
				description={
					<>
						<p className="mt-0">
							They can no longer sign in, and their running workspaces stop.
						</p>
						<p className="mb-0 text-content-secondary">
							{suspendable.map((u) => u.username).join(", ")}
						</p>
					</>
				}
				confirmText="Suspend"
				onClose={() => setAction(undefined)}
				onConfirm={() =>
					void run("Suspended", suspendable, (u) => API.suspendUser(u.id))
				}
			/>

			{action === "delete" && (
				<BulkDeleteDialog
					users={others}
					busy={busy}
					onClose={() => setAction(undefined)}
					onConfirm={() =>
						void run("Deleted", others, (u) => API.deleteUser(u.id))
					}
				/>
			)}
		</div>
	);
};

type RoleChoice = "keep" | "add" | "remove";

const BulkRolesDialog: React.FC<{
	users: readonly User[];
	busy: boolean;
	onClose: () => void;
	onApply: (add: string[], remove: string[]) => Promise<void>;
}> = ({ users, busy, onClose, onApply }) => {
	const query = useQuery(roles());
	const assignable = (query.data ?? []).filter((r) => r.assignable);
	const [choices, setChoices] = useState<Record<string, RoleChoice>>({});
	const have = (name: string) =>
		users.filter((u) => u.roles.some((r) => r.name === name)).length;
	const add = Object.entries(choices)
		.filter(([, c]) => c === "add")
		.map(([n]) => n);
	const remove = Object.entries(choices)
		.filter(([, c]) => c === "remove")
		.map(([n]) => n);

	return (
		<ConfirmDialog
			type="info"
			hideCancel={false}
			open
			confirmLoading={busy}
			disabled={add.length + remove.length === 0}
			title={`Roles of ${users.length} ${users.length === 1 ? "account" : "accounts"}`}
			confirmText="Apply"
			onClose={onClose}
			onConfirm={() => void onApply(add, remove)}
			description={
				query.isLoading ? (
					<Spinner loading />
				) : (
					<div className="flex flex-col gap-3" data-testid="bulk-roles">
						<p className="m-0 text-sm text-content-secondary">
							Tick a role to give it to every one of them, clear it to take it
							away; a role some of them have stays as it is until you choose.
						</p>
						{assignable.map((role) => {
							const n = have(role.name);
							const choice = choices[role.name] ?? "keep";
							const checked =
								choice === "add"
									? true
									: choice === "remove"
										? false
										: n === users.length
											? true
											: n === 0
												? false
												: "indeterminate";
							const id = `bulk-role-${role.name}`;
							return (
								<div key={role.name} className="flex items-start gap-2">
									<Checkbox
										id={id}
										checked={checked}
										onCheckedChange={(v) =>
											setChoices((c) => ({
												...c,
												[role.name]: v === true ? "add" : "remove",
											}))
										}
									/>
									<Label htmlFor={id} className="flex flex-col gap-0.5">
										<span className="text-sm">
											{role.display_name || role.name}
										</span>
										<span className="text-xs font-normal text-content-secondary">
											{choice === "keep"
												? `${n} of ${users.length} have it`
												: choice === "add"
													? "given to all of them"
													: "taken from all of them"}
										</span>
									</Label>
								</div>
							);
						})}
					</div>
				)
			}
		/>
	);
};

const BulkDeleteDialog: React.FC<{
	users: readonly User[];
	busy: boolean;
	onClose: () => void;
	onConfirm: () => void;
}> = ({ users, busy, onClose, onConfirm }) => {
	const [typed, setTyped] = useState("");
	const ok = typed === "delete";
	return (
		<ConfirmDialog
			type="delete"
			hideCancel={false}
			open
			confirmLoading={busy}
			disabled={!ok}
			title={`Delete ${users.length} ${users.length === 1 ? "account" : "accounts"}`}
			confirmText="Delete"
			onClose={onClose}
			onConfirm={onConfirm}
			description={
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (ok) {
							onConfirm();
						}
					}}
				>
					<p className="m-0">
						Deleting accounts is irreversible:{" "}
						{users.map((u) => u.username).join(", ")}.
					</p>
					<Label htmlFor="bulk-delete-typed">
						Type &ldquo;delete&rdquo; to confirm
					</Label>
					<Input
						id="bulk-delete-typed"
						autoComplete="off"
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
					/>
				</form>
			}
		/>
	);
};
