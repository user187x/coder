import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { myAvatar, resetAvatar, uploadAvatar } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Spinner } from "#/components/Spinner/Spinner";
import { setUserAvatar } from "#/contexts/platformBoot";
import {
	AVATAR_TARGET,
	ImageNormalizeError,
	normalizeImage,
} from "../normalizeImage";
import { closeAvatarDialog, useAvatarDialogOpen } from "./avatarDialogStore";

/**
 * Renders the avatar dialog wherever it is opened from (the user menu, the
 * Account page). Mounted once for the whole dashboard.
 */
export const AvatarDialogHost: React.FC = () => {
	const open = useAvatarDialogOpen();
	return open ? <AvatarDialog onClose={closeAvatarDialog} /> : null;
};

type AvatarDialogProps = {
	onClose: () => void;
};

/**
 * Pick any picture as your own avatar. It is kept in Coder's database by the
 * platform service and shown as a circle wherever Coder shows you.
 */
const AvatarDialog: React.FC<AvatarDialogProps> = ({ onClose }) => {
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);
	const meQuery = useQuery(myAvatar());
	const upload = useMutation(uploadAvatar(queryClient));
	const reset = useMutation(resetAvatar(queryClient));
	const [next, setNext] = useState<{ dataURL: string; name: string }>();
	const [pickError, setPickError] = useState<string>();

	const me = meQuery.data;
	const busy = upload.isPending || reset.isPending;
	const preview = next?.dataURL ?? me?.url ?? me?.defaultUrl ?? undefined;
	const initials = (me?.username ?? "?").slice(0, 2).toUpperCase();
	const unavailable = me !== undefined && !me.available;

	const pick = async (file: File) => {
		setPickError(undefined);
		try {
			const { dataURL } = await normalizeImage(file, AVATAR_TARGET);
			setNext({ dataURL, name: file.name });
		} catch (error) {
			setNext(undefined);
			setPickError(
				error instanceof ImageNormalizeError
					? error.message
					: "This browser cannot read that file as a picture. Try a PNG, JPEG, WebP, GIF or AVIF.",
			);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(isOpen) => {
				if (!isOpen && !busy) {
					onClose();
				}
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Your avatar</DialogTitle>
					<DialogDescription>
						Any picture works, animated ones too (GIF, PNG, WebP, AVIF). It is
						cropped to a square and resized for you, and shown as a circle
						wherever Coder shows you.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-5">
					<span
						aria-hidden
						className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-solid border-border bg-surface-secondary text-2xl font-semibold text-content-secondary"
					>
						{meQuery.isLoading ? (
							<Spinner loading />
						) : preview ? (
							<img src={preview} alt="" className="size-full object-cover" />
						) : (
							initials
						)}
					</span>
					<div className="flex min-w-0 flex-col gap-2">
						<Button
							variant="outline"
							disabled={busy || unavailable}
							onClick={() => inputRef.current?.click()}
						>
							Choose a picture…
						</Button>
						<input
							ref={inputRef}
							type="file"
							accept="image/*"
							aria-label="Choose a picture"
							className="hidden"
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								if (file) {
									void pick(file);
								}
							}}
						/>
						<span
							className="truncate text-sm text-content-secondary"
							aria-live="polite"
						>
							{next?.name}
						</span>
					</div>
				</div>

				{unavailable && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						Avatars are not available: the platform service is not connected to
						Coder's database.
					</p>
				)}
				{meQuery.error ? <ErrorAlert error={meQuery.error} /> : null}
				{pickError && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{pickError}
					</p>
				)}
				{(upload.error || reset.error) && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{getErrorMessage(
							upload.error ?? reset.error,
							"The avatar could not be saved.",
						)}
					</p>
				)}

				<DialogFooter className="gap-2">
					{me?.set && (
						<Button
							variant="outline"
							className="sm:mr-auto"
							disabled={busy}
							onClick={() =>
								reset.mutate(undefined, {
									onSuccess: () => {
										setUserAvatar(me.username, null);
										onClose();
									},
								})
							}
						>
							<Spinner loading={reset.isPending} />
							Remove avatar
						</Button>
					)}
					<Button variant="outline" disabled={busy} onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={busy || !next || !me}
						onClick={() => {
							if (!next || !me) {
								return;
							}
							upload.mutate(next.dataURL, {
								onSuccess: ({ url }) => {
									setUserAvatar(me.username, url);
									onClose();
								},
							});
						}}
					>
						<Spinner loading={upload.isPending} />
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
