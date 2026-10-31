import { BracesIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { securityAuditLogs } from "#/api/queries/audits";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { AuditEndpointCard } from "./AuditEndpointCard";
import { ExportAuditLogsButton } from "./ExportAuditLogsButton";

const filters = [
	["All events", ""],
	["Sign-ins", "action:login"],
	["Sign-outs", "action:logout"],
	["User accounts", "resource_type:user"],
	["Workspaces", "resource_type:workspace"],
	["Roles", "resource_type:custom_role"],
] as const;

/** Security events use the same authenticated and authorized audit API as the full audit view. */
export const SecurityActivity = () => {
	const [expose, setExpose] = useState(false);
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState({ q: "", page: 0 });
	const query = useQuery(securityAuditLogs(filter.q, filter.page));
	const apply = (q: string) => {
		setSearch(q);
		setFilter({ q, page: 0 });
	};
	return (
		<section aria-label="Coder security logs" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h2 className="m-0 text-xl">Coder security logs</h2>
					<p className="mb-0 text-sm text-content-secondary">
						Sign-ins, access attempts, and administrative and user activity.
						Times use your local time zone.
					</p>
				</div>
				<div className="flex flex-wrap items-start gap-2">
					<ExportAuditLogsButton filter={filter.q} />
					<Button
						variant="outline"
						size="sm"
						aria-expanded={expose}
						onClick={() => setExpose((value) => !value)}
					>
						<BracesIcon />
						Expose Audit Endpoint
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						<RefreshCwIcon />
						Refresh logs
					</Button>
				</div>
			</div>
			{expose && <AuditEndpointCard />}
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					setFilter({ q: search, page: 0 });
				}}
			>
				<Input
					aria-label="Filter security logs"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="action:login username:admin date_from:2026-10-30"
				/>
				<Button type="submit" variant="outline">
					Search logs
				</Button>
			</form>
			<div className="flex flex-wrap gap-2">
				{filters.map(([label, value]) => (
					<Button
						key={label}
						size="sm"
						variant={filter.q === value ? "default" : "outline"}
						onClick={() => apply(value)}
					>
						{label}
					</Button>
				))}
			</div>
			<p className="m-0 text-xs text-content-secondary">
				Password attempts show the submitted email, including unknown accounts.
				External sign-in providers may keep rejected attempts in their own logs.
				Events are available only while logging is enabled. Passwords and
				session tokens are never shown.
			</p>
			{query.isError && (
				<div role="alert" className="text-sm text-content-destructive">
					{getErrorMessage(query.error, "Could not load security logs.")}{" "}
					<Button
						size="sm"
						variant="outline"
						onClick={() => void query.refetch()}
					>
						Retry logs
					</Button>
				</div>
			)}
			<div className="overflow-x-auto rounded-xl border border-solid border-border">
				<Table aria-label="Security events">
					<TableHeader>
						<TableRow>
							<TableHead>Time</TableHead>
							<TableHead>Account / submitted login</TableHead>
							<TableHead>Event</TableHead>
							<TableHead>Result</TableHead>
							<TableHead>IP address</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{query.isLoading && (
							<TableRow>
								<TableCell colSpan={5}>Loading security events…</TableCell>
							</TableRow>
						)}
						{query.data?.audit_logs.length === 0 && (
							<TableRow>
								<TableCell colSpan={5}>
									No recorded events match this filter.
								</TableCell>
							</TableRow>
						)}
						{query.data?.audit_logs.map((event) => (
							<TableRow key={event.id}>
								<TableCell className="whitespace-nowrap text-xs">
									<time dateTime={event.time}>
										{new Date(event.time).toLocaleString("en-US", {
											dateStyle: "medium",
											timeStyle: "medium",
										})}
									</time>
								</TableCell>
								<TableCell>
									<div>
										{event.user?.username ??
											(event.additional_fields.submitted_identifier
												? "Unknown account"
												: "System / unidentified")}
									</div>
									{event.additional_fields.submitted_identifier && (
										<div className="break-all text-xs text-content-secondary">
											{event.additional_fields.submitted_identifier}
										</div>
									)}
								</TableCell>
								<TableCell>
									<div className="capitalize">
										{event.action.replaceAll("_", " ")} ·{" "}
										{event.resource_type.replaceAll("_", " ")}
									</div>
									<div className="text-xs text-content-secondary break-all">
										{event.resource_target || event.resource_id}
									</div>
								</TableCell>
								<TableCell>
									<span
										className={
											event.status_code >= 400
												? "text-content-destructive"
												: "text-content-success"
										}
									>
										{event.status_code >= 400 ? "Failed" : "Succeeded"}
									</span>
									<div className="text-xs text-content-secondary">
										HTTP {event.status_code}
									</div>
								</TableCell>
								<TableCell className="font-mono text-xs">
									{event.ip || "Unknown"}
									<details className="mt-1">
										<summary className="cursor-pointer text-content-secondary">
											Details
										</summary>
										<p className="max-w-56 break-all">
											Request: {event.request_id}
											<br />
											Client: {event.user_agent || "Unknown"}
											<br />
											Organization: {event.organization?.name || "Deployment"}
										</p>
									</details>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="flex items-center justify-between gap-4 text-sm text-content-secondary">
				<span>{query.data ? `${query.data.count} recorded events` : ""}</span>
				<div className="flex items-center gap-3">
					<Button
						size="sm"
						variant="outline"
						disabled={filter.page === 0 || query.isFetching}
						onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
					>
						Newer events
					</Button>
					<span>Page {filter.page + 1}</span>
					<Button
						size="sm"
						variant="outline"
						disabled={
							!query.data ||
							(filter.page + 1) * 25 >= query.data.count ||
							query.isFetching
						}
						onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
					>
						Older events
					</Button>
				</div>
			</div>
		</section>
	);
};
