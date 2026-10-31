import type { QueryClient } from "react-query";
import { API } from "#/api/api";
import type { CreateAuditCollectorRequest } from "#/api/typesGenerated";

export const auditCollectors = (organizationId: string) => ({
	queryKey: ["auditCollectors", organizationId] as const,
	queryFn: () => API.getAuditCollectors(organizationId),
	enabled: organizationId !== "",
	refetchInterval: 30_000,
});

export const createAuditCollector = (
	client: QueryClient,
	organizationId: string,
) => ({
	mutationFn: (request: CreateAuditCollectorRequest) =>
		API.createAuditCollector(organizationId, request),
	onSuccess: () =>
		client.invalidateQueries({
			queryKey: auditCollectors(organizationId).queryKey,
		}),
});

export const deleteAuditCollector = (
	client: QueryClient,
	organizationId: string,
) => ({
	mutationFn: (collectorId: string) =>
		API.deleteAuditCollector(organizationId, collectorId),
	onSuccess: () =>
		client.invalidateQueries({
			queryKey: auditCollectors(organizationId).queryKey,
		}),
});
