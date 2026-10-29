import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	sandboxGroups,
	sandboxWorkspaces,
	updateSandbox,
} from "#/api/queries/sandbox";
import type { Workspace } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
export const SandboxControl = ({ workspace }: { workspace: Workspace }) => {
	const client = useQueryClient();
	const groupId = useId();
	const groups = useQuery(sandboxGroups(workspace.organization_id));
	const workspaces = useQuery(sandboxWorkspaces(workspace.organization_name));
	const [selected, setSelected] = useState<string[]>([workspace.id]);
	const [group, setGroup] = useState("new");
	const change = useMutation(updateSandbox(client, workspace.organization_id));
	const current = groups.data?.groups.find((g) =>
		g.workspaces.some((w) => w.id === workspace.id),
	);
	const available =
		workspaces.data?.workspaces.filter(
			(w) => w.organization_id === workspace.organization_id,
		) ?? [];
	const selectedAvailable = selected.filter((id) =>
		available.some((w) => w.id === id),
	);
	const error = groups.error || workspaces.error || change.error;
	return (
		<div className="space-y-4">
			<p>
				Sandbox members can communicate with each other. Internet and other
				workspace traffic are blocked. Coder browser and terminal controls
				remain available.
			</p>
			{error && <ErrorAlert error={error} />}
			{change.data?.error && (
				<Alert severity="warning">
					Policy saved; enforcement is pending: {change.data.error}
				</Alert>
			)}
			{groups.isLoading || workspaces.isLoading ? (
				<Spinner />
			) : current ? (
				<>
					<p>Sandbox {current.id}</p>
					<ul>
						{current.workspaces.map((w) => (
							<li key={w.id}>{w.name}</li>
						))}
					</ul>
					<Button
						disabled={change.isPending}
						onClick={() =>
							change.mutate({
								workspace_ids: [],
								group_id: current.id,
								release: true,
							})
						}
					>
						Release sandbox group
					</Button>
				</>
			) : (
				<>
					<Label htmlFor={groupId}>Sandbox group</Label>
					<Select value={group} onValueChange={setGroup}>
						<SelectTrigger id={groupId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="new">New sandbox group</SelectItem>
							{groups.data?.groups.map((g) => (
								<SelectItem key={g.id} value={g.id}>
									{g.workspaces.map((w) => w.name).join(", ")}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<fieldset className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-solid border-border p-3">
						<legend>Workspaces</legend>
						{available.length === 0 && <p>No workspaces available.</p>}
						{available.map((w) => (
							<Label key={w.id} className="flex items-center gap-2">
								<Checkbox
									checked={selected.includes(w.id)}
									onCheckedChange={(checked) =>
										setSelected((ids) =>
											checked
												? [...ids, w.id]
												: ids.filter((id) => id !== w.id),
										)
									}
								/>
								{w.owner_name}/{w.name}
							</Label>
						))}
					</fieldset>
					<Button
						disabled={
							!selectedAvailable.length ||
							change.isPending ||
							Boolean(groups.error || workspaces.error)
						}
						onClick={() =>
							change.mutate({
								workspace_ids: selectedAvailable,
								...(group !== "new" ? { group_id: group } : {}),
							})
						}
					>
						Apply sandbox
					</Button>
				</>
			)}
		</div>
	);
};
