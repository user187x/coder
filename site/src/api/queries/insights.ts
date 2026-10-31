import type { UseQueryOptions } from "react-query";
import { API, type InsightsParams } from "#/api/api";
import type { GetUserStatusCountsResponse } from "#/api/typesGenerated";

export const insightsUserLatency = (params: InsightsParams) => {
	return {
		queryKey: ["insights", "userLatency", params.template_ids, params],
		queryFn: () => API.getInsightsUserLatency(params),
	};
};

export const insightsUserActivity = (params: InsightsParams) => {
	return {
		queryKey: ["insights", "userActivity", params.template_ids, params],
		queryFn: () => API.getInsightsUserActivity(params),
	};
};

export const insightsUserStatusCounts = () => {
	return {
		queryKey: ["insights", "userStatusCounts"],
		queryFn: () => API.getInsightsUserStatusCounts(),
		select: (data) => data.status_counts,
	} satisfies UseQueryOptions<
		GetUserStatusCountsResponse,
		unknown,
		GetUserStatusCountsResponse["status_counts"]
	>;
};
