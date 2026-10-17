import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	cloudDriveConnections,
	setCloudDriveConnection,
} from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { Switch } from "#/components/Switch/Switch";

/**
 * The Cloud Drive window's Workspaces: each of the account's workspaces with a switch, connected to the drive (it
 * has ~/cloud-drive) or not - what the Workspaces page's cables do by dragging, here by switch (and keyboard).
 */
export const CloudDriveConnections: React.FC = () => {
	const list = useQuery(workspaces({ q: "owner:me" }));
	const connections = useQuery(cloudDriveConnections());
	const queryClient = useQueryClient();
	const link = useMutation(setCloudDriveConnection(queryClient));
	const mine = list.data?.workspaces ?? [];
	const off = new Set(connections.data?.disconnected ?? []);
	const older = new Set(connections.data?.older ?? []);

	return (
		<div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-6 py-5">
			<p className="m-0 text-sm text-content-secondary">
				A connected workspace has your Cloud Drive at ~/cloud-drive; a new one
				is connected. On the Workspaces page, drag a cable's plug away from a
				workspace to disconnect it, or a cable out of the Cloud Drive onto one
				to connect it.
			</p>
			{list.isLoading || connections.isLoading ? (
				<p className="m-0 text-sm text-content-secondary">Reading…</p>
			) : list.isError || connections.isError ? (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{getErrorMessage(
						list.error ?? connections.error,
						"Your workspaces could not be read.",
					)}
				</p>
			) : mine.length === 0 ? (
				<p className="m-0 text-sm text-content-secondary">
					You have no workspaces yet.
				</p>
			) : (
				<ul className="m-0 flex list-none flex-col p-0">
					{mine.map((w) => {
						const on = !off.has(w.id);
						const id = `cloud-drive-link-${w.id}`;
						return (
							<li
								key={w.id}
								className="flex items-center gap-3 border-0 border-b border-solid border-border py-2 last:border-b-0"
							>
								<label
									htmlFor={id}
									className="flex min-w-0 flex-1 flex-col text-sm"
								>
									<span className="truncate font-medium text-content-primary">
										{w.name}
									</span>
									<span className="text-xs text-content-secondary">
										{on ? "Connected" : "Disconnected"}
										{older.has(w.id) &&
											" · takes effect once it is updated to its template's latest version"}
									</span>
								</label>
								<Switch
									id={id}
									checked={on}
									disabled={link.isPending}
									onCheckedChange={(connected) =>
										link.mutate(
											{ workspaceId: w.id, connected },
											{
												onError: (err) =>
													toast.error(getErrorMessage(err, "Not changed.")),
											},
										)
									}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};
