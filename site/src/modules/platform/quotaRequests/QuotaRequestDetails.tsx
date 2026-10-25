import type { FC } from "react";
import type { QuotaRequest } from "#/api/quotaRequests";
import type { Organization } from "#/api/typesGenerated";

type Props = {
	request: QuotaRequest;
	organizations?: readonly Pick<Organization, "id" | "name" | "display_name">[];
};

const requestDate = (seconds: number) => {
	const date = new Date(seconds * 1000);
	return Number.isFinite(date.getTime())
		? date.toLocaleString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZone: "UTC",
				timeZoneName: "short",
			})
		: "Unknown";
};

/** Shared request history keeps organization scope visible beside global extras. */
export const QuotaRequestDetails: FC<Props> = ({
	request,
	organizations = [],
}) => {
	const organization = organizations.find(
		(org) => org.id === request.organization_id,
	);
	const amounts = [
		request.resources.cpu > 0
			? `+${request.resources.cpu.toLocaleString("en-US")} CPU cores`
			: null,
		request.resources.memory > 0
			? `+${request.resources.memory.toLocaleString("en-US")} GiB memory`
			: null,
		request.resources.workspaces > 0
			? `+${request.resources.workspaces.toLocaleString("en-US")} ${request.resources.workspaces === 1 ? "workspace" : "workspaces"}`
			: null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="flex flex-col gap-2 text-sm">
			<p className="m-0 break-words text-content-secondary">
				Organization:{" "}
				{organization?.display_name ||
					organization?.name ||
					request.organization_id}
			</p>
			<p className="m-0 text-xs text-content-secondary">
				Requested {requestDate(request.created_at)}
				{request.reviewed_at !== undefined && (
					<> · Reviewed {requestDate(request.reviewed_at)}</>
				)}
			</p>
			<p className="m-0 font-medium">{amounts || "No additional resources"}</p>
			<p className="m-0 whitespace-pre-wrap break-words">{request.reason}</p>
			{request.review_reason && (
				<p className="m-0 whitespace-pre-wrap break-words text-content-secondary">
					Admin: {request.review_reason}
				</p>
			)}
		</div>
	);
};
