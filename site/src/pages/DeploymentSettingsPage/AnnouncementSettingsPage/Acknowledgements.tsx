import { cn } from "cn";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	AnnouncementEvent,
	AnnouncementReport,
	PlatformUser,
} from "#/api/platform";
import {
	announcementReport,
	deleteAnnouncementEvent,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Loader } from "#/components/Loader/Loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import {
	LEVEL_COLORS,
	parseColors,
	plainLabel,
} from "#/modules/platform/announcement/bannerTokens";

const formatWhen = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleString("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: "N/A";

/**
 * Every announcement published (or shown again), with who has seen it and
 * who pressed Confirm; open one to see the people. A record can be deleted.
 */
export const Acknowledgements: React.FC = () => {
	const reportQuery = useQuery(announcementReport());

	return (
		<section
			aria-labelledby="announcement-acks"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="announcement-acks" className="m-0 text-base font-semibold">
					Acknowledgements
				</h2>
				{reportQuery.dataUpdatedAt > 0 && (
					<span className="text-xs text-content-secondary" data-pixel="ignore">
						Updated{" "}
						{new Date(reportQuery.dataUpdatedAt).toLocaleTimeString("en-US")}
					</span>
				)}
			</div>
			<p className="m-0 text-sm text-content-secondary">
				Each announcement you publish (or show again) is listed with everyone
				who has seen it and who pressed Confirm. Open one to see the people.
			</p>
			{reportQuery.isLoading ? (
				<Loader />
			) : !reportQuery.data ? (
				<ErrorAlert error={reportQuery.error} />
			) : (
				<AcknowledgementList report={reportQuery.data} />
			)}
		</section>
	);
};

const AcknowledgementList: React.FC<{ report: AnnouncementReport }> = ({
	report,
}) => {
	if (!report.events.length) {
		return (
			<p className="m-0 text-sm text-content-secondary">
				No announcement has been shown yet. Publish one and confirmations appear
				here.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{report.events.map((event, i) => (
				<AnnouncementEventRow
					key={event.id}
					event={event}
					totalUsers={report.totalUsers}
					shownAgain={report.events
						.slice(i + 1)
						.some(
							(older) =>
								older.level === event.level &&
								older.title === event.title &&
								older.message === event.message,
						)}
				/>
			))}
		</div>
	);
};

type AnnouncementEventRowProps = {
	event: AnnouncementEvent;
	totalUsers: number | null;
	shownAgain: boolean;
};

const AnnouncementEventRow: React.FC<AnnouncementEventRowProps> = ({
	event,
	totalUsers,
	shownAgain,
}) => {
	const queryClient = useQueryClient();
	const remove = useMutation(deleteAnnouncementEvent(queryClient));
	const [open, setOpen] = useState(event.current);
	const [confirming, setConfirming] = useState(false);
	const total = totalUsers ?? event.viewed;
	const percent = total ? Math.round((event.acked / total) * 100) : 0;
	const label = plainLabel(event.title, event.message);
	const colour =
		parseColors(event.title)?.bg ??
		LEVEL_COLORS[event.level]?.bg ??
		LEVEL_COLORS.info.bg;

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="rounded-md border border-solid border-border"
		>
			<div className="flex items-center gap-3 px-3 py-2">
				<CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-inherit">
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"size-icon-sm shrink-0 text-content-secondary transition-transform",
							open && "rotate-90",
						)}
					/>
					<span
						aria-hidden
						className="size-2.5 shrink-0 rounded-full"
						style={{ background: colour }}
					/>
					<span className="min-w-0 flex-1 truncate text-sm font-medium">
						{label}
					</span>
					{shownAgain && (
						<Badge
							size="xs"
							title="The same announcement, re-shown to everyone"
						>
							Shown again
						</Badge>
					)}
					{event.current && (
						<Badge size="xs" variant="green">
							Live now
						</Badge>
					)}
					<span
						className="hidden shrink-0 items-center gap-2 text-xs text-content-secondary tabular-nums md:flex"
						title={`${event.acked} confirmed, ${event.viewed} seen${totalUsers !== null ? `, ${totalUsers} active users` : ""}`}
					>
						<span
							aria-hidden
							className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-tertiary"
						>
							<span
								className="absolute inset-y-0 left-0 rounded-full bg-content-success"
								style={{ width: `${percent}%` }}
							/>
						</span>
						{event.acked}
						{totalUsers !== null ? ` / ${totalUsers}` : ""} confirmed ·{" "}
						{event.viewed} seen
					</span>
					<span className="hidden shrink-0 text-xs text-content-secondary lg:block">
						{formatWhen(event.firstSeen)}
					</span>
				</CollapsibleTrigger>
				<Button
					variant="subtle"
					size="icon"
					aria-label="Delete this announcement and its confirmations"
					title="Delete this announcement and its confirmations"
					onClick={() => setConfirming(true)}
				>
					<XIcon />
				</Button>
			</div>
			<CollapsibleContent>
				<div className="border-0 border-t border-solid border-border p-3">
					<ReceiptsTable event={event} />
				</div>
			</CollapsibleContent>
			<ConfirmDialog
				type="delete"
				open={confirming}
				title="Delete this record"
				description={`Delete the record of "${label.slice(0, 80)}"? ${
					event.current
						? "This announcement is live: its confirmations start again from nobody."
						: "Its confirmations are deleted."
				}`}
				confirmLoading={remove.isPending}
				onClose={() => setConfirming(false)}
				onConfirm={() =>
					remove.mutate(event.id, {
						onSuccess: () => {
							setConfirming(false);
							toast.success("Deleted.");
						},
						onError: (error) => {
							toast.error(
								getErrorMessage(error, "The record could not be deleted."),
							);
						},
					})
				}
			/>
		</Collapsible>
	);
};

const Person: React.FC<{
	person: Pick<PlatformUser, "username" | "name" | "email">;
}> = ({ person }) => (
	<div className="flex flex-col">
		<span className="font-medium">{person.name || person.username}</span>
		<span className="text-xs text-content-secondary">
			{person.name
				? `${person.username}${person.email ? ` · ${person.email}` : ""}`
				: person.email}
		</span>
	</div>
);

const ReceiptsTable: React.FC<{ event: AnnouncementEvent }> = ({ event }) => {
	const pending = event.pending ?? [];
	return (
		<Table aria-label="Who saw and confirmed this announcement">
			<TableHeader>
				<TableRow>
					<TableHead>Person</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Seen</TableHead>
					<TableHead>Confirmed</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{event.receipts.length === 0 && pending.length === 0 ? (
					<TableEmpty message="Nobody has seen this announcement yet." />
				) : null}
				{event.receipts.map((receipt) => (
					<TableRow key={receipt.username}>
						<TableCell>
							<Person person={receipt} />
						</TableCell>
						<TableCell>
							{receipt.ackedAt ? (
								<Badge size="xs" variant="green">
									Confirmed
								</Badge>
							) : (
								<Badge size="xs" variant="warning">
									Seen, not confirmed
								</Badge>
							)}
						</TableCell>
						<TableCell>{formatWhen(receipt.viewedAt)}</TableCell>
						<TableCell>{formatWhen(receipt.ackedAt)}</TableCell>
					</TableRow>
				))}
				{pending.map((user) => (
					<TableRow key={user.id} className="text-content-secondary">
						<TableCell>
							<Person person={user} />
						</TableCell>
						<TableCell>
							<Badge size="xs">Not seen yet</Badge>
						</TableCell>
						<TableCell>N/A</TableCell>
						<TableCell>N/A</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
};
