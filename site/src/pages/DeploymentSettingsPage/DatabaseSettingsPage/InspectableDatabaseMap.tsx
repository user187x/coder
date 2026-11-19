import { useRef, useState } from "react";
import type { PersistenceReport } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { bytes } from "#/modules/platform/ClusterVisuals";
import {
	type DatabaseMapTarget,
	PersistenceMap,
	replicationLabel,
} from "../PersistenceSettingsPage/PersistenceMap";

export function InspectableDatabaseMap({
	report,
	showSummary,
	onAddTarget,
}: {
	report: PersistenceReport;
	showSummary?: boolean;
	onAddTarget?: () => void;
}) {
	const [inspection, setInspection] = useState<DatabaseMapTarget | null>(null);
	const inspectionTrigger = useRef<HTMLElement | null>(null);

	return (
		<>
			<PersistenceMap
				report={report}
				showSummary={showSummary}
				onAddTarget={onAddTarget}
				onInspect={(target) => {
					const active = document.activeElement;
					inspectionTrigger.current =
						active instanceof HTMLElement ? active : null;
					setInspection(target);
				}}
			/>
			<Dialog
				open={inspection !== null}
				onOpenChange={(open) => {
					if (!open) setInspection(null);
				}}
			>
				{inspection && (
					<DatabaseInspection
						report={report}
						target={inspection}
						onCloseAutoFocus={(event) => {
							if (inspectionTrigger.current?.isConnected) {
								event.preventDefault();
								inspectionTrigger.current.focus();
							}
						}}
					/>
				)}
			</Dialog>
		</>
	);
}

function DatabaseInspection({
	report,
	target,
	onCloseAutoFocus,
}: {
	report: PersistenceReport;
	target: DatabaseMapTarget;
	onCloseAutoFocus: React.ComponentProps<
		typeof DialogContent
	>["onCloseAutoFocus"];
}) {
	const { cluster, coderDatabase, database, backups, instances, provider } =
		report.facts;
	let title: string;
	let fields: ReadonlyArray<
		readonly [string, string | number | null | undefined]
	>;
	switch (target.kind) {
		case "coder":
			title = "Coder connection";
			fields = [
				["Host", coderDatabase.host],
				["Database", coderDatabase.database],
				["Role", coderDatabase.user],
				["TLS mode", coderDatabase.sslMode ?? "Default"],
				["Configuration source", coderDatabase.source],
			];
			break;
		case "endpoint":
			title = "Database endpoint";
			fields = [
				["Host", coderDatabase.host],
				["Port", coderDatabase.port ?? (coderDatabase.host ? 5432 : null)],
				["Provider", provider],
				["Primary", cluster?.primary],
				["PostgreSQL version", database?.version],
				["Active connections", database?.connections],
				["Connection limit", database?.maxConnections],
			];
			break;
		case "instance": {
			const instance = instances.find((item) => item.name === target.name);
			title = target.name;
			fields = instance
				? [
						["Role", instance.role],
						["Status", instance.ready ? "Ready" : "Not ready"],
						["Node", instance.node],
						["Zone", instance.zone],
						["Pod IP", instance.podIP],
						["Replication", replicationLabel(instance)],
						["Data volume", instance.pvc?.name],
						["Data capacity", bytes(instance.pvc?.capacityBytes)],
						["WAL volume", instance.walPvc?.name],
						["Restarts", instance.restarts],
					]
				: [["Status", "Instance no longer reported"]];
			break;
		}
		case "backups":
			title = "Backups";
			fields = [
				["Configured", backups ? (backups.configured ? "Yes" : "No") : null],
				["Method", backups?.method],
				["Schedule", backups?.schedule],
				["Completed backups", backups?.count],
				["Last successful backup", backups?.lastSuccess],
				["Last failed backup", backups?.lastFailure],
				["Recoverable since", backups?.recoverableSince],
			];
			break;
	}

	return (
		<DialogContent onCloseAutoFocus={onCloseAutoFocus}>
			<DialogTitle>{title}</DialogTitle>
			<DialogDescription>
				Details from the latest database report.
			</DialogDescription>
			<dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
				{fields.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-content-secondary">{label}</dt>
						<dd className="m-0 wrap-anywhere">{value ?? "Not reported"}</dd>
					</div>
				))}
			</dl>
			<DialogFooter>
				<DialogClose asChild>
					<Button variant="outline">Close</Button>
				</DialogClose>
			</DialogFooter>
		</DialogContent>
	);
}
