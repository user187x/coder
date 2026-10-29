import { API } from "./api";
import type {
	CreateShortTermLeaseRequest,
	ShortTermLease,
	UpdateShortTermLeaseRequest,
} from "./typesGenerated";

const root = (org: string) =>
	`/api/v2/organizations/${encodeURIComponent(org)}/short-term-leases`;
export const ShortTermLeasesAPI = {
	list: async (org: string) =>
		(await API.getAxiosInstance().get<ShortTermLease[]>(root(org))).data,
	create: async (org: string, request: CreateShortTermLeaseRequest) =>
		(await API.getAxiosInstance().post<ShortTermLease>(root(org), request))
			.data,
	update: async (
		org: string,
		user: string,
		request: UpdateShortTermLeaseRequest,
	) =>
		(
			await API.getAxiosInstance().patch<ShortTermLease>(
				`${root(org)}/${encodeURIComponent(user)}`,
				request,
			)
		).data,
	me: async () =>
		(
			await API.getAxiosInstance().get<ShortTermLease | null>(
				"/api/v2/short-term-lease",
			)
		).data,
	request: async () =>
		(
			await API.getAxiosInstance().post<ShortTermLease>(
				"/api/v2/short-term-lease/extension",
			)
		).data,
	login: async (token: string) =>
		(
			await API.getAxiosInstance().post<ShortTermLease>(
				"/api/v2/short-term-lease/login",
				{ token },
			)
		).data,
};
