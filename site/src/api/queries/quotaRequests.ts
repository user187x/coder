import type { QueryClient } from "react-query";
import { QuotaRequestsAPI } from "#/api/quotaRequests";
import { quotaMeKey, quotaReportKey } from "./platform";

export const quotaRequestsKey = ["platform", "quota-requests"] as const;
export const quotaRequests = (admin: boolean) => ({
	queryKey: [...quotaRequestsKey, admin ? "admin" : "me"],
	queryFn: () => QuotaRequestsAPI.list(admin),
	refetchInterval: 10_000,
	retry: false,
});
const invalidate = (client: QueryClient) => async () => {
	await Promise.all([
		client.invalidateQueries({ queryKey: quotaRequestsKey }),
		client.invalidateQueries({ queryKey: quotaMeKey }),
		client.invalidateQueries({ queryKey: quotaReportKey }),
	]);
};
export const createQuotaRequest = (client: QueryClient) => ({
	mutationFn: QuotaRequestsAPI.create,
	onSettled: invalidate(client),
});
export const decideQuotaRequest = (client: QueryClient) => ({
	mutationFn: QuotaRequestsAPI.decide,
	onSettled: invalidate(client),
});
