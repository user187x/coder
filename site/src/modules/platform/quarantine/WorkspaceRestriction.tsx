import { ShieldBanIcon } from "lucide-react";
import { useQuery } from "react-query";
import { workspaceQuarantine } from "#/api/queries/workspaceQuarantine";
import type { Workspace } from "#/api/typesGenerated";
import { TableRow } from "#/components/Table/Table";
import { modeOf, useWorkspaceLockdown } from "../lockdown/Lockdown";
import "./workspaceRestriction.css";

/** Quarantine applies before enforcement acknowledgement; partial network/sudo policies remain distinct. */
export function useWorkspaceRestricted(workspace: Workspace | undefined) {
	const lock = useWorkspaceLockdown(workspace?.id);
	const quarantine = useQuery({
		...workspaceQuarantine(
			workspace?.organization_id ?? "",
			workspace?.id ?? "",
		),
		enabled: Boolean(workspace),
	});
	const mode = modeOf(lock);
	return Boolean(
		quarantine.data?.enabled ||
			quarantine.data?.manual_start_required ||
			(lock?.locked && (mode === "complete" || mode === "freeze")),
	);
}

export const WorkspaceRestrictionNotice: React.FC<{ name: string }> = ({
	name,
}) => (
	<div role="status" className="workspace-restriction-notice">
		<ShieldBanIcon className="size-4 shrink-0" aria-hidden />
		<span>
			{name} Has been locked down. Please contact your administrator if you have
			any questions.
		</span>
	</div>
);

export const WorkspaceRestrictionAvatar: React.FC<{
	workspace: Workspace;
	children: React.ReactNode;
}> = ({ workspace, children }) => {
	const restricted = useWorkspaceRestricted(workspace);
	return (
		<span className="relative inline-flex shrink-0">
			{children}
			{restricted && (
				<span
					role="img"
					aria-label={`${workspace.name} is locked down or quarantined`}
					title="Locked down or quarantined"
					className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-solid border-border bg-surface-primary text-content-warning"
				>
					<ShieldBanIcon className="size-3.5" aria-hidden />
				</span>
			)}
		</span>
	);
};

export const RestrictedWorkspaceRow: React.FC<
	React.ComponentProps<typeof TableRow> & { workspace: Workspace }
> = ({ workspace, className, children, ...props }) => {
	const restricted = useWorkspaceRestricted(workspace);
	return (
		<TableRow
			{...props}
			className={[className, restricted ? "workspace-restricted-pole" : ""]
				.filter(Boolean)
				.join(" ")}
		>
			{children}
		</TableRow>
	);
};
