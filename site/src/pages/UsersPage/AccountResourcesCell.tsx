import { ChevronDownIcon } from "lucide-react";
import { useContext, useId } from "react";
import type { User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { QuotaAdjustments } from "#/modules/platform/quotaRequests/QuotaAdjustments";
import { formatQuotaNumber } from "./quotaFormatting";
import { QuotaEditorContext, QuotaUsageCells } from "./UserQuotaSection";

/** Keeps allocation visible while detailed quota readings and edits stay together. */
export const AccountResourcesCell: React.FC<{
	user: Pick<User, "id" | "username">;
}> = ({ user }) => {
	const quota = useContext(QuotaEditorContext);
	const titleId = useId();
	const entry = quota?.report?.users.find((item) => item.id === user.id);
	const summary = entry
		? `${formatQuotaNumber(entry.usage.workspaces)} workspaces · CPU ${formatQuotaNumber(entry.usage.cpu)} · RAM ${formatQuotaNumber(entry.usage.memory)} GiB`
		: quota?.error
			? "Quota unavailable"
			: quota?.report
				? "No resource data"
				: "Loading quota…";
	return (
		<TableCell data-account-field="resources">
			<Popover>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						aria-label={`Resources for ${user.username}: ${summary}`}
						className="h-auto min-h-8 w-full min-w-0 gap-1 whitespace-nowrap px-1.5 py-1.5 text-left"
					>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="text-xs font-medium">Resources</span>
							<span className="flex items-center gap-1 whitespace-nowrap text-[9px] font-normal tabular-nums text-content-secondary">
								{entry ? (
									<>
										<span className="text-content-primary">WS</span>{" "}
										{formatQuotaNumber(entry.usage.workspaces)}
										<span aria-hidden>·</span>
										<span className="text-content-primary">CPU</span>{" "}
										{formatQuotaNumber(entry.usage.cpu)}
										<span aria-hidden>·</span>
										<span className="text-content-primary">RAM</span>{" "}
										{formatQuotaNumber(entry.usage.memory)} GiB
									</>
								) : (
									summary
								)}
							</span>
						</span>
						<ChevronDownIcon aria-hidden className="size-3.5" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					aria-labelledby={titleId}
					className="account-resource-popover w-[min(42rem,calc(100vw-2rem))] p-4"
				>
					<h3 id={titleId} className="m-0 text-base font-medium">
						Resources for {user.username}
					</h3>
					<p className="mb-3 text-xs text-content-secondary">
						Allocated resources, running workspaces and live usage. Empty
						overrides use the default; “none” removes a limit. Dotted sections
						show approved additions.
					</p>
					{quota?.error ? <ErrorAlert error={quota.error} /> : null}
					<div className="overflow-x-auto">
						<Table
							className="account-resource-details"
							aria-label={`Resource quota for ${user.username}`}
						>
							<TableHeader>
								<TableRow>
									<TableHead>Workspaces</TableHead>
									<TableHead>CPU cores</TableHead>
									<TableHead>Memory (GiB)</TableHead>
									<TableHead>Disk (GB)</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								<TableRow>
									<QuotaUsageCells userId={user.id} />
								</TableRow>
							</TableBody>
						</Table>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<QuotaAdjustments user={user} />
						<Button
							size="sm"
							disabled={!quota?.dirty || quota.saving}
							onClick={quota?.onSave}
						>
							{quota?.saving ? "Saving…" : "Save quota"}
						</Button>
						{quota?.dirty && (
							<Button
								size="sm"
								variant="outline"
								disabled={quota.saving}
								onClick={quota.onDiscard}
							>
								Discard changes
							</Button>
						)}
					</div>
					{quota?.dirty && (
						<p className="mb-0 text-xs text-content-secondary">
							Save and discard apply to all pending account quota changes.
						</p>
					)}
				</PopoverContent>
			</Popover>
		</TableCell>
	);
};
