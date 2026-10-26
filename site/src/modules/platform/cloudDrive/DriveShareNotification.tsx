import { useQuery } from "react-query";
import { useSearchParams } from "react-router";
import { cloudDrivePeers } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { CloudDriveShareCard } from "./CloudDrivePeers";

/** Inbox links open the same authorized review card used in the sharing view. */
export const DriveShareNotification: React.FC<{ userId: string }> = ({
	userId,
}) => {
	const [params, setParams] = useSearchParams();
	const id = params.get("driveShare");
	const query = useQuery({ ...cloudDrivePeers(), enabled: Boolean(id) });
	const available = [
		...(query.data?.asked ?? []),
		...(query.data?.ofMine ?? []),
		...(query.data?.all ?? []),
	].some((s) => s.id === id);
	return (
		<Dialog
			open={Boolean(id)}
			onOpenChange={(open) => {
				if (!open)
					setParams(
						(old) => {
							const next = new URLSearchParams(old);
							next.delete("driveShare");
							return next;
						},
						{ replace: true },
					);
			}}
		>
			<DialogContent
				className="z-[95]"
				overlayClassName="z-[94] backdrop-blur-sm"
			>
				<DialogTitle>Cloud Drive notification</DialogTitle>
				{query.isLoading ? (
					<p>Loading share...</p>
				) : query.isError ? (
					<>
						<ErrorAlert error={query.error} />
						<Button variant="outline" onClick={() => void query.refetch()}>
							Retry
						</Button>
					</>
				) : id && available ? (
					<CloudDriveShareCard shareId={id} meId={userId} />
				) : (
					<p>This share is no longer available to your account.</p>
				)}
				<DialogClose asChild>
					<Button variant="outline">Close</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
};
