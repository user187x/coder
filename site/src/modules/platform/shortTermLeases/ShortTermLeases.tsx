import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { organizations } from "#/api/queries/organizations";
import {
	createShortTermLease,
	shortTermLeases,
	updateShortTermLease,
} from "#/api/queries/shortTermLeases";
import { templates } from "#/api/queries/templates";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";

import { useTime } from "#/hooks/useTime";

export const ShortTermLeases = ({
	clock = Date.now,
}: {
	clock?: () => number;
}) => {
	const id = useId();
	const now = useTime(clock);
	const client = useQueryClient();
	const orgs = useQuery(organizations());
	const allTemplates = useQuery(templates());
	const [chosenOrg, setOrg] = useState("");
	const org = chosenOrg || orgs.data?.[0]?.id || "";
	const [template, setTemplate] = useState("");
	const [minutes, setMinutes] = useState("15");
	const [tokens, setTokens] = useState<Record<string, string>>({});
	const rows = useQuery(shortTermLeases(org));
	const create = useMutation(createShortTermLease(client, org));
	const update = useMutation(updateShortTermLease(client, org));
	const browserTemplates =
		allTemplates.data?.filter(
			(t) =>
				t.organization_id === org &&
				["browser", "neko"].includes(t.name.toLowerCase()),
		) ?? [];
	const selectedTemplate = browserTemplates.some((t) => t.id === template)
		? template
		: browserTemplates[0]?.id || "";
	const duration = Number(minutes);
	const validDuration =
		Number.isInteger(duration) && duration >= 1 && duration <= 1440;
	const error =
		rows.error ||
		orgs.error ||
		allTemplates.error ||
		create.error ||
		update.error;
	return (
		<section
			className="my-6 rounded-xl border border-solid border-border p-5"
			aria-labelledby={`${id}-short-term-lease-title`}
		>
			<h2
				id={`${id}-short-term-lease-title`}
				className="mt-0 text-lg font-semibold"
			>
				Short Term Lease
			</h2>
			<p className="text-sm text-content-secondary">
				Issue temporary access to a fresh, isolated Browser workspace. Expired
				leases cannot be renewed.
			</p>
			{error && <ErrorAlert error={error} />}
			<div className="mb-4 flex flex-wrap items-end gap-3">
				<div>
					<Label htmlFor={`${id}-lease-organization`}>Organization</Label>
					<Select value={org} onValueChange={setOrg}>
						<SelectTrigger id={`${id}-lease-organization`}>
							<SelectValue placeholder="Choose organization" />
						</SelectTrigger>
						<SelectContent>
							{orgs.data?.map((o) => (
								<SelectItem key={o.id} value={o.id}>
									{o.display_name || o.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div>
					<Label htmlFor={`${id}-lease-template`}>Browser template</Label>
					<Select value={selectedTemplate} onValueChange={setTemplate}>
						<SelectTrigger id={`${id}-lease-template`}>
							<SelectValue placeholder="No Browser template available" />
						</SelectTrigger>
						<SelectContent>
							{browserTemplates.map((t) => (
								<SelectItem key={t.id} value={t.id}>
									{t.display_name || t.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div>
					<Label htmlFor={`${id}-lease-minutes`}>Minutes</Label>
					<Input
						id={`${id}-lease-minutes`}
						className="w-24"
						type="number"
						min={1}
						max={1440}
						value={minutes}
						onChange={(e) => setMinutes(e.target.value)}
					/>
				</div>
				<Button
					disabled={!selectedTemplate || !validDuration || create.isPending}
					onClick={() =>
						create.mutate(
							{ template_id: selectedTemplate, minutes: duration },
							{
								onSuccess: (lease) => {
									if (lease.token)
										setTokens((current) => ({
											...current,
											[lease.user_id]: lease.token || "",
										}));
								},
							},
						)
					}
				>
					New Lease
				</Button>
			</div>
			<p className="text-xs text-content-secondary">
				Give the user their token and{" "}
				<a href="/lease">the lease sign-in link</a>. Full tokens appear only
				when issued; copy them before leaving this page.
			</p>
			{rows.isLoading ? (
				<Spinner />
			) : (
				<Table aria-label="Short Term Leases">
					<TableHeader>
						<TableRow>
							{[
								"User GUID",
								"Time issued",
								"Time expires",
								"Workspace accessible",
								"Session token",
								"Actions",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.data?.length === 0 && (
							<TableRow>
								<TableCell colSpan={6}>No leases issued.</TableCell>
							</TableRow>
						)}
						{rows.data?.map((row) => {
							const active =
								!row.revoked_at && Date.parse(row.expires_at) > now;
							return (
								<TableRow key={row.user_id}>
									<TableCell>
										<code className="break-all">{row.user_id}</code>
									</TableCell>
									<TableCell>
										{new Date(row.issued_at).toLocaleString("en-US")}
									</TableCell>
									<TableCell>
										{new Date(row.expires_at).toLocaleString("en-US")}
										<div>
											{row.revoked_at
												? "Revoked"
												: active
													? "Active"
													: "Expired"}
										</div>
										{row.extension_requested_at && (
											<div className="text-content-warning">
												Extension requested
											</div>
										)}
									</TableCell>
									<TableCell>
										Browser
										{row.workspace_id && (
											<div className="max-w-40 break-all text-xs">
												{row.workspace_id}
											</div>
										)}
									</TableCell>
									<TableCell>
										<code className="break-all">
											{tokens[row.user_id] ||
												(row.token_id ? `${row.token_id}••••` : "Not issued")}
										</code>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-2">
											<Button
												size="sm"
												variant="outline"
												disabled={!active || !validDuration || update.isPending}
												onClick={() =>
													update.mutate({
														user: row.user_id,
														minutes: duration,
														revoke: false,
													})
												}
											>
												Extend {validDuration ? duration : ""} min
											</Button>
											<Button
												size="sm"
												variant="outline"
												disabled={!active || update.isPending}
												onClick={() =>
													update.mutate({
														user: row.user_id,
														minutes: 0,
														revoke: true,
													})
												}
											>
												Revoke
											</Button>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</section>
	);
};
