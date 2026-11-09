import type { QueryClient } from "react-query";
import { API, type CollectorKind } from "#/api/api";
import type { CreateAuditCollectorRequest } from "#/api/typesGenerated";

export const auditCollectors = (
	organizationId: string,
	kind: CollectorKind = "audit",
) => ({
	queryKey: ["auditCollectors", organizationId, kind] as const,
	queryFn: () => API.getAuditCollectors(organizationId, kind),
	enabled: organizationId !== "",
	refetchInterval: 30_000,
});

export const createAuditCollector = (
	client: QueryClient,
	organizationId: string,
	kind: CollectorKind = "audit",
) => ({
	mutationFn: (request: CreateAuditCollectorRequest) =>
		API.createAuditCollector(organizationId, request, kind),
	onSuccess: () =>
		client.invalidateQueries({
			queryKey: auditCollectors(organizationId, kind).queryKey,
		}),
});

export const deleteAuditCollector = (
	client: QueryClient,
	organizationId: string,
	kind: CollectorKind = "audit",
) => ({
	mutationFn: (collectorId: string) =>
		API.deleteAuditCollector(organizationId, collectorId, kind),
	onSuccess: () =>
		client.invalidateQueries({
			queryKey: auditCollectors(organizationId, kind).queryKey,
		}),
});
