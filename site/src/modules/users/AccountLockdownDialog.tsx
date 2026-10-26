import { useState } from "react";
import { useQuery } from "react-query";
import { workspaces } from "#/api/queries/workspaces";
import type { User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { LockdownBadge } from "#/modules/platform/lockdown/Lockdown";

/** Uses the dashboard's controls for an explicitly selected account workspace. */
export const AccountLockdownDialog: React.FC<{
	user: User;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}> = ({ user, open, onOpenChange }) => {
	const [selected, setSelected] = useState("");
	const query = useQuery({
		...workspaces({ q: `owner:${user.username}`, limit: 0 }),
		enabled: open,
	});
	const available =
		query.data?.workspaces.filter(
			(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
		) ?? [];
	const workspace = available.find((w) => w.id === selected) ?? available[0];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				overlayClassName="backdrop-blur-md"
				className="max-h-[85vh] overflow-y-auto"
			>
				<DialogTitle>Lock Down {user.username}</DialogTitle>
				{query.isLoading && <Spinner loading />}
				{query.error && (
					<>
						<ErrorAlert error={query.error} />
						<Button variant="outline" onClick={() => void query.refetch()}>
							Retry workspaces
						</Button>
					</>
				)}
				{available.length > 0 ? (
					<>
						<Label htmlFor={`lockdown-workspace-${user.id}`}>Workspace</Label>
						<Select value={workspace?.id} onValueChange={setSelected}>
							<SelectTrigger id={`lockdown-workspace-${user.id}`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="z-[100]">
								{available.map((w) => (
									<SelectItem key={w.id} value={w.id}>
										{w.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{workspace && (
							<LockdownBadge
								key={workspace.id}
								workspace={workspace}
								goldIcon
								panel
							/>
						)}
					</>
				) : (
					!query.isLoading && !query.error && <p>No workspaces available.</p>
				)}
			</DialogContent>
		</Dialog>
	);
};
