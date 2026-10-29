import type { QueryClient } from "react-query";
import { ShortTermLeasesAPI } from "../shortTermLeases";
import type {
	CreateShortTermLeaseRequest,
	UpdateShortTermLeaseRequest,
} from "../typesGenerated";
export const leasesKey = (org: string) => ["short-term-leases", org] as const;
export const myLeaseKey = ["short-term-lease", "me"] as const;
export const shortTermLeases = (org: string) => ({
	queryKey: leasesKey(org),
	queryFn: () => ShortTermLeasesAPI.list(org),
	enabled: Boolean(org),
	refetchInterval: 5000,
});
export const myShortTermLease = () => ({
	queryKey: myLeaseKey,
	queryFn: ShortTermLeasesAPI.me,
	refetchInterval: 5000,
	retry: false,
});
export const createShortTermLease = (client: QueryClient, org: string) => ({
	mutationFn: (request: CreateShortTermLeaseRequest) =>
		ShortTermLeasesAPI.create(org, request),
	onSettled: () => client.invalidateQueries({ queryKey: leasesKey(org) }),
});
export const updateShortTermLease = (client: QueryClient, org: string) => ({
	mutationFn: ({
		user,
		...request
	}: UpdateShortTermLeaseRequest & { user: string }) =>
		ShortTermLeasesAPI.update(org, user, request),
	onSettled: () => client.invalidateQueries({ queryKey: leasesKey(org) }),
});
export const requestLeaseExtension = (client: QueryClient) => ({
	mutationFn: ShortTermLeasesAPI.request,
	onSettled: () => client.invalidateQueries({ queryKey: myLeaseKey }),
});
export const leaseLogin = () => ({ mutationFn: ShortTermLeasesAPI.login });
