import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import { organizations } from "#/api/queries/organizations";
import {
	createShortTermLease,
	removeShortTermLease,
	shortTermLeases,
	updateShortTermLease,
} from "#/api/queries/shortTermLeases";
import { templates } from "#/api/queries/templates";
import type { ShortTermLease } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
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
import { Textarea } from "#/components/Textarea/Textarea";
import { useTime } from "#/hooks/useTime";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { LeaseAccess } from "./LeaseAccess";
import { LeaseSignInLink } from "./LeaseSignInLink";

export const ShortTermLeases = ({
	clock = Date.now,
	creating: controlledCreating,
	onCreatingChange,
}: {
	clock?: () => number;
	creating?: boolean;
	onCreatingChange?: (open: boolean) => void;
}) => {
	const id = useId();
	const section = useRef<HTMLElement>(null);
	const { hash } = useLocation();
	useEffect(() => {
		if (hash === "#short-term-leases")
			section.current?.scrollIntoView({ block: "start" });
	}, [hash]);
	const now = useTime(clock);
	const client = useQueryClient();
	const orgs = useQuery(organizations());
	const allTemplates = useQuery(templates());
	const [template, setTemplate] = useState("");
	const [minutes, setMinutes] = useState("15");
	const [localCreating, setLocalCreating] = useState(false);
	const creating = controlledCreating ?? localCreating;
	const setCreating = onCreatingChange ?? setLocalCreating;
	const [issuedToken, setIssuedToken] = useState("");
	const [accessUser, setAccessUser] = useState("");
	const [websiteMode, setWebsiteMode] = useState("all");
	const [websites, setWebsites] = useState("");
	const [firewall, setFirewall] = useState(true);
	const [autoRemove, setAutoRemove] = useState(false);
	const [filter, setFilter] = useState("all");
	const queries = useQueries({
		queries: (orgs.data ?? []).map((org) => shortTermLeases(org.id)),
	});
	const rows = queries.flatMap((query) => query.data ?? []);
	const accessLease = rows.find(
		(row) =>
			row.user_id === accessUser &&
			!row.revoked_at &&
			Date.parse(row.expires_at) > now,
	);
	const [extending, setExtending] = useState<ShortTermLease | null>(null);
	const [extensionMinutes, setExtensionMinutes] = useState("15");
	const extensionDuration = Number(extensionMinutes);
	const validExtension =
		Number.isInteger(extensionDuration) &&
		extensionDuration >= 1 &&
		extensionDuration <= 1440;
	const create = useMutation(createShortTermLease(client));
	const update = useMutation(updateShortTermLease(client));
	const remove = useMutation(removeShortTermLease(client));
	const browserTemplates =
		allTemplates.data?.filter((t) =>
			["browser", "neko"].includes(t.name.toLowerCase()),
		) ?? [];
	const selectedTemplate =
		browserTemplates.find((t) => t.id === template) ?? browserTemplates[0];
	const duration = Number(minutes);
	const validDuration =
		Number.isInteger(duration) && duration >= 1 && duration <= 1440;
	const error =
		queries.find((query) => query.error)?.error ||
		orgs.error ||
		allTemplates.error ||
		create.error ||
		update.error ||
		remove.error;
	const visibleRows = rows.filter(
		(row) =>
			filter === "all" ||
			(filter === "active") ===
				(!row.revoked_at && Date.parse(row.expires_at) > now),
	);

	return (
		<section
			ref={section}
			id="short-term-leases"
			className="mb-6 rounded-lg border border-solid border-border p-6"
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
			<div className="mb-4">
				<LeaseSignInLink />
			</div>
			{Boolean(error) && <ErrorAlert error={error} />}
			<div className="mb-4 flex flex-wrap items-end gap-3">
				<Button
					onClick={() => {
						setIssuedToken("");
						setCreating(true);
					}}
				>
					New Lease
				</Button>
				<Select value={filter} onValueChange={setFilter}>
					<SelectTrigger aria-label="Lease status" className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All leases</SelectItem>
						<SelectItem value="active">Active</SelectItem>
						<SelectItem value="history">History</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<Dialog
				open={creating}
				onOpenChange={(open) => {
					if (!create.isPending && !issuedToken) setCreating(open);
				}}
			>
				<DialogContent>
					<DialogTitle>New short term lease</DialogTitle>
					<DialogDescription>
						Create an isolated Browser workspace. Website restrictions apply
						only to Chromium.
					</DialogDescription>
					<LeaseSignInLink />
					{issuedToken ? (
						<>
							<p>
								Give this token and the lease sign-in URL to the tenant. An
								administrator can reveal it again from the lease table.
							</p>
							<CodeExample
								code={issuedToken}
								secret={false}
								copyLabel="Copy lease token"
							/>
							<Button
								onClick={() => {
									setCreating(false);
									setIssuedToken("");
								}}
							>
								Done
							</Button>
						</>
					) : (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<Label htmlFor={`${id}-lease-template`}>
										Browser template
									</Label>
									<Select
										value={selectedTemplate?.id ?? ""}
										onValueChange={setTemplate}
									>
										<SelectTrigger id={`${id}-lease-template`}>
											<SelectValue placeholder="No Browser template available" />
										</SelectTrigger>
										<SelectContent>
											{browserTemplates.map((t) => (
												<SelectItem key={t.id} value={t.id}>
													{t.display_name || t.name}
													{browserTemplates.length > 1 &&
														` (${t.organization_display_name || t.organization_name})`}
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
							</div>
							<div className="flex flex-wrap gap-2">
								<Badge>No root</Badge>
								<Badge>Leased Browser only</Badge>
							</div>
							<p className="m-0 text-xs text-content-secondary">
								Tenants cannot create other workspaces, open terminals, or
								access other apps.
							</p>
							<label
								htmlFor={`${id}-firewall`}
								className="flex items-center gap-2"
							>
								<Checkbox
									id={`${id}-firewall`}
									checked={firewall}
									onCheckedChange={(v) => setFirewall(v === true)}
								/>
								Firewall: allow web, DNS and required Coder services
							</label>
							<div>
								<Label htmlFor={`${id}-websites-mode`}>Browser websites</Label>
								<Select value={websiteMode} onValueChange={setWebsiteMode}>
									<SelectTrigger id={`${id}-websites-mode`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All websites</SelectItem>
										<SelectItem value="allowlist">
											Only listed websites
										</SelectItem>
										<SelectItem value="blocklist">
											Block listed websites
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{websiteMode !== "all" && (
								<div>
									<Label htmlFor={`${id}-websites`}>Website domains</Label>
									<Textarea
										id={`${id}-websites`}
										value={websites}
										onChange={(e) => setWebsites(e.target.value)}
										placeholder="example.com"
									/>
									<p className="text-xs text-content-secondary">
										One domain per line. Subdomains are included. Maximum 100
										domains.
									</p>
								</div>
							)}
							<label
								htmlFor={`${id}-auto-remove`}
								className="flex items-center gap-2"
							>
								<Checkbox
									id={`${id}-auto-remove`}
									checked={autoRemove}
									onCheckedChange={(v) => setAutoRemove(v === true)}
								/>
								Remove from history when expired or revoked
							</label>
							{create.error && <ErrorAlert error={create.error} />}
							<Button
								disabled={
									!selectedTemplate ||
									!validDuration ||
									create.isPending ||
									(websiteMode !== "all" && !websites.trim())
								}
								onClick={() =>
									create.mutate(
										{
											org: selectedTemplate?.organization_id ?? "",
											template_id: selectedTemplate?.id ?? "",
											minutes: duration,
											auto_remove_history: autoRemove,
											terms: {
												no_root: true,
												sandbox_only: true,
												firewall,
												website_mode: websiteMode,
												websites:
													websiteMode === "all"
														? []
														: websites
																.split(/[,\n]/)
																.map((v) => v.trim())
																.filter(Boolean),
											},
										},
										{
											onSuccess: (lease) => {
												if (lease.token) setIssuedToken(lease.token);
												else setCreating(false);
											},
										},
									)
								}
							>
								Issue lease
							</Button>
						</>
					)}
				</DialogContent>
			</Dialog>

			<Dialog
				open={Boolean(extending)}
				onOpenChange={(open) => {
					if (!open && !update.isPending) setExtending(null);
				}}
			>
				<DialogContent>
					<DialogTitle>Extend lease</DialogTitle>
					<DialogDescription>Add time to this active lease.</DialogDescription>
					<div>
						<Label htmlFor={`${id}-extension-minutes`}>Extension minutes</Label>
						<Input
							id={`${id}-extension-minutes`}
							type="number"
							min={1}
							max={1440}
							value={extensionMinutes}
							onChange={(event) => setExtensionMinutes(event.target.value)}
						/>
					</div>
					{Boolean(update.error) && <ErrorAlert error={update.error} />}
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							disabled={update.isPending}
							onClick={() => setExtending(null)}
						>
							Cancel
						</Button>
						<Button
							disabled={!validExtension || update.isPending}
							onClick={() => {
								if (extending)
									update.mutate(
										{
											org: extending.organization_id,
											user: extending.user_id,
											minutes: extensionDuration,
											revoke: false,
										},
										{ onSuccess: () => setExtending(null) },
									);
							}}
						>
							Extend lease
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			{orgs.isLoading || queries.some((query) => query.isLoading) ? (
				<Spinner />
			) : (
				<TableCard
					summary={`Showing ${visibleRows?.length ?? 0} of ${rows.length} leases`}
				>
					<Table aria-label="Short Term Leases">
						<TableHeader>
							<TableRow>
								{[
									"Account",
									"Status",
									"Lifetime",
									"Workspace",
									"Terms",
									"Actions",
								].map((h) => (
									<TableHead key={h}>{h}</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{visibleRows?.length === 0 && (
								<TableRow>
									<TableCell colSpan={6}>No leases match this view.</TableCell>
								</TableRow>
							)}
							{visibleRows?.map((row) => {
								const active =
									!row.revoked_at && Date.parse(row.expires_at) > now;
								return (
									<TableRow
										key={row.user_id}
										onPointerEnter={() => setAccessUser(row.user_id)}
										onFocusCapture={() => setAccessUser(row.user_id)}
									>
										<TableCell>
											<code title={row.user_id}>
												lease-{row.user_id.slice(0, 8)}
											</code>
										</TableCell>
										<TableCell>
											<Badge>
												{row.revoked_at
													? "Revoked"
													: active
														? "Active"
														: "Expired"}
											</Badge>
											{row.extension_requested_at && active && (
												<div className="mt-1 text-xs text-content-warning">
													Extension requested
												</div>
											)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											<div>
												Issued {new Date(row.issued_at).toLocaleString("en-US")}
											</div>
											<div className="mt-1 text-content-secondary">
												Expires{" "}
												{new Date(row.expires_at).toLocaleString("en-US")}
											</div>
										</TableCell>
										<TableCell>
											<span title={row.workspace_id || undefined}>
												Browser {row.workspace_id?.slice(0, 8)}
											</span>
										</TableCell>
										<TableCell>
											<details>
												<summary className="cursor-pointer text-xs">
													{row.terms ? "Restricted Browser" : "Original policy"}
												</summary>
												<div className="mt-2 max-w-56 text-xs">
													{row.terms ? (
														<>
															<p>No root. Leased Browser only.</p>
															<p>
																Firewall {row.terms.firewall ? "on" : "off"}.
															</p>
															<p>
																{row.terms.website_mode}:{" "}
																{row.terms.websites.join(", ") ||
																	"all websites"}
															</p>
														</>
													) : (
														<p>Existing template restrictions.</p>
													)}
													<p>
														{row.auto_remove_history
															? "Automatic history removal"
															: "Manual history removal"}
													</p>
												</div>
											</details>
										</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-2">
												{active && (
													<Button
														size="sm"
														variant="outline"
														onClick={() => setAccessUser(row.user_id)}
													>
														Sign-in details
													</Button>
												)}
												{active ? (
													<>
														<Button
															size="sm"
															variant="outline"
															disabled={!active || update.isPending}
															onClick={() => {
																setExtensionMinutes("15");
																setExtending(row);
															}}
														>
															Extend…
														</Button>
														<Button
															size="sm"
															variant="outline"
															disabled={!active || update.isPending}
															onClick={() =>
																update.mutate({
																	org: row.organization_id,
																	user: row.user_id,
																	minutes: 0,
																	revoke: true,
																})
															}
														>
															Revoke
														</Button>
													</>
												) : (
													<Button
														size="sm"
														variant="outline"
														disabled={remove.isPending}
														onClick={() =>
															remove.mutate({
																org: row.organization_id,
																user: row.user_id,
															})
														}
													>
														Delete history
													</Button>
												)}
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
						{accessLease && (
							<tfoot>
								<TableRow>
									<TableCell colSpan={6}>
										<LeaseAccess
											key={accessLease.user_id}
											lease={accessLease}
										/>
									</TableCell>
								</TableRow>
							</tfoot>
						)}
					</Table>
				</TableCard>
			)}
		</section>
	);
};
