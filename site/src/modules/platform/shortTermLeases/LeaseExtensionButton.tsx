import { ClockIcon } from "lucide-react";
import { useMutation, useQueryClient } from "react-query";
import { requestLeaseExtension } from "#/api/queries/shortTermLeases";
import type { ShortTermLease } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
export const LeaseExtensionButton = ({ lease }: { lease: ShortTermLease }) => {
	const client = useQueryClient();
	const request = useMutation(requestLeaseExtension(client));
	return (
		<div className="flex flex-wrap items-center gap-2">
			{request.error && <ErrorAlert error={request.error} />}
			<Button
				variant="outline"
				size="sm"
				disabled={request.isPending || Boolean(lease.extension_requested_at)}
				onClick={() => request.mutate()}
			>
				<ClockIcon />
				{lease.extension_requested_at
					? "Extension requested"
					: "Request Extension"}
			</Button>
			<span className="text-xs text-content-secondary">
				Lease expires {new Date(lease.expires_at).toLocaleString("en-US")}
			</span>
		</div>
	);
};
