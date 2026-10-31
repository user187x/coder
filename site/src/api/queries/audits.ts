import { API } from "#/api/api";
import type { AuditLogResponse } from "#/api/typesGenerated";
import { useFilterParamsKey } from "#/components/Filter/Filter";
import type { UsePaginatedQueryOptions } from "#/hooks/usePaginatedQuery";

export function paginatedAudits(
	searchParams: URLSearchParams,
): UsePaginatedQueryOptions<AuditLogResponse, string> {
	return {
		searchParams,
		queryPayload: () => searchParams.get(useFilterParamsKey) ?? "",
		queryKey: ({ payload, pageNumber }) => {
			return ["auditLogs", payload, pageNumber] as const;
		},
		queryFn: ({ payload, limit, offset }) => {
			return API.getAuditLogs({
				offset,
				limit,
				q: payload,
			});
		},
		prefetch: false,
	};
}

export const securityAuditLogs = (q: string, page: number) => ({
	queryKey: ["auditLogs", "security", q, page] as const,
	queryFn: () => API.getAuditLogs({ q, offset: page * 25, limit: 25 }),
	refetchInterval: 15000,
});

export const exportSecurityAuditLogs = () => ({
	// Zero uses the audit API's unlimited query, independent of its capped count.
	mutationFn: (q: string) => API.getAuditLogs({ q, offset: 0, limit: 0 }),
});
