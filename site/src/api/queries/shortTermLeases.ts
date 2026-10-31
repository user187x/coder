import type { QueryClient } from "react-query";
import { ShortTermLeasesAPI } from "../shortTermLeases";
import type {
	CreateShortTermLeaseRequest,
	UpdateShortTermLeaseRequest,
} from "../typesGenerated";

const leasesKey = (org: string) => ["short-term-leases", org] as const;
const myLeaseKey = ["short-term-lease", "me"] as const;
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
export const createShortTermLease = (client: QueryClient) => ({
	mutationFn: ({
		org,
		...request
	}: CreateShortTermLeaseRequest & { org: string }) =>
		ShortTermLeasesAPI.create(org, request),
	onSettled: (_data: unknown, _error: unknown, { org }: { org: string }) =>
		client.invalidateQueries({ queryKey: leasesKey(org) }),
});
export const updateShortTermLease = (client: QueryClient) => ({
	mutationFn: ({
		org,
		user,
		...request
	}: UpdateShortTermLeaseRequest & { org: string; user: string }) =>
		ShortTermLeasesAPI.update(org, user, request),
	onSettled: (_data: unknown, _error: unknown, { org }: { org: string }) =>
		client.invalidateQueries({ queryKey: leasesKey(org) }),
});
export const requestLeaseExtension = (client: QueryClient) => ({
	mutationFn: ShortTermLeasesAPI.request,
	onSettled: () => client.invalidateQueries({ queryKey: myLeaseKey }),
});
export const leaseLogin = () => ({ mutationFn: ShortTermLeasesAPI.login });

export const removeShortTermLease = (client: QueryClient) => ({
	mutationFn: ({ org, user }: { org: string; user: string }) =>
		ShortTermLeasesAPI.remove(org, user),
	onSettled: (_data: unknown, _error: unknown, { org }: { org: string }) =>
		client.invalidateQueries({ queryKey: leasesKey(org) }),
});
