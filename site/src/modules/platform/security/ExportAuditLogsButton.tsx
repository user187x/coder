import { saveAs } from "file-saver";
import { DownloadIcon } from "lucide-react";
import { useMutation } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { exportSecurityAuditLogs } from "#/api/queries/audits";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";

export const ExportAuditLogsButton: React.FC<{
	filter: string;
	download?: (file: Blob, filename: string) => void;
}> = ({ filter, download = saveAs }) => {
	const exportLogs = useMutation({
		...exportSecurityAuditLogs(),
		onSuccess: (result, appliedFilter) => {
			const exportedAt = new Date().toISOString();
			const file = new Blob(
				[
					JSON.stringify(
						{
							exported_at: exportedAt,
							filter: appliedFilter,
							count: result.audit_logs.length,
							audit_logs: result.audit_logs,
						},
						null,
						2,
					),
				],
				{ type: "application/json" },
			);
			download(
				file,
				`coder-security-logs-${exportedAt.replaceAll(":", "-")}.json`,
			);
		},
	});
	return (
		<div className="flex flex-col gap-2">
			<Button
				size="sm"
				variant="outline"
				disabled={exportLogs.isPending}
				onClick={() => exportLogs.mutate(filter)}
			>
				{exportLogs.isPending ? <Spinner loading /> : <DownloadIcon />}
				{exportLogs.isPending ? "Exporting logs…" : "Export Logs"}
			</Button>
			{exportLogs.error && (
				<p
					role="alert"
					className="m-0 max-w-64 text-xs text-content-destructive"
				>
					{getErrorMessage(
						exportLogs.error,
						"Could not export security logs. Try again.",
					)}
				</p>
			)}
		</div>
	);
};
