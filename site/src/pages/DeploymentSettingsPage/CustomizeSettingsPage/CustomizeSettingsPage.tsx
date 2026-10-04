import { cn } from "cn";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { LogoState } from "#/api/platform";
import { logo, resetLogo, uploadLogo } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { FileUpload } from "#/components/FileUpload/FileUpload";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Spinner } from "#/components/Spinner/Spinner";
import { DEFAULT_LOGO_URL, setLogoURL } from "#/contexts/platformBoot";
import { formatBytes } from "#/modules/platform/images";
import {
	ImageNormalizeError,
	LOGO_TARGET,
	type NormalizedImage,
	normalizeImage,
} from "#/modules/platform/normalizeImage";
import AppearancePage from "#/pages/UserSettingsPage/AppearancePage/AppearancePage";
import { pageTitle } from "#/utils/page";

const LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp", "gif", "avif"];

/**
 * General > Customize: the logo shown everywhere in Coder (navigation bar,
 * sign-in and set-up pages, browser tab icon), stored in Coder's own database
 * by the platform service, and your own appearance: theme and terminal font.
 */
const CustomizeSettingsPage: React.FC = () => {
	return (
		<>
			<title>{pageTitle("Customize")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Customize</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					The logo shown everywhere in Coder (navigation bar, sign-in and set-up
					pages, browser tab icon), and your appearance: theme and terminal
					font.
				</SettingsHeaderDescription>
			</SettingsHeader>

			<LogoSection />

			<section
				aria-labelledby="customize-appearance"
				className="mt-10 border-0 border-t border-solid border-border pt-8"
			>
				<h2
					id="customize-appearance"
					className="m-0 mb-2 text-2xl font-semibold"
				>
					Appearance
				</h2>
				<p className="m-0 mb-8 text-sm font-medium text-content-secondary">
					Your own theme and terminal font.
				</p>
				<AppearancePage />
			</section>
		</>
	);
};

const LogoSection: React.FC = () => {
	const queryClient = useQueryClient();
	const logoQuery = useQuery(logo());
	const reset = useMutation(resetLogo(queryClient));
	const [uploading, setUploading] = useState(false);
	const [confirmingReset, setConfirmingReset] = useState(false);

	if (logoQuery.isLoading) {
		return <Loader />;
	}
	if (!logoQuery.data) {
		return <ErrorAlert error={logoQuery.error} />;
	}

	return (
		<>
			<LogoView
				logo={logoQuery.data}
				onUpload={() => setUploading(true)}
				onReset={() => setConfirmingReset(true)}
			/>
			{uploading && <LogoUploadDialog onClose={() => setUploading(false)} />}
			<ConfirmDialog
				type="delete"
				open={confirmingReset}
				title="Restore the default logo"
				description="Remove the custom logo and show the default logo again?"
				confirmText="Restore"
				confirmLoading={reset.isPending}
				onClose={() => setConfirmingReset(false)}
				onConfirm={() =>
					reset.mutate(undefined, {
						onSuccess: () => {
							setLogoURL(null);
							setConfirmingReset(false);
							toast.success("The default logo is back.");
						},
						onError: (error) => {
							toast.error(
								getErrorMessage(error, "The logo could not be reset."),
							);
						},
					})
				}
			/>
		</>
	);
};

type LogoViewProps = {
	logo: LogoState;
	onUpload: () => void;
	onReset: () => void;
};

export const LogoView: React.FC<LogoViewProps> = ({
	logo,
	onUpload,
	onReset,
}) => {
	return (
		<section
			aria-labelledby="customize-logo"
			className="rounded-lg border border-solid border-border p-6"
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 id="customize-logo" className="m-0 text-base font-semibold">
					Current logo
				</h2>
				<Badge variant={logo.set ? "green" : "default"}>
					{!logo.available
						? "Not available"
						: logo.set
							? "Custom logo"
							: "Default logo"}
				</Badge>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<LogoPreview theme="dark" src={logo.url} caption="Dark theme" />
				<LogoPreview theme="light" src={logo.url} caption="Light theme" />
			</div>
			<p className="m-0 mt-4 text-sm text-content-secondary">
				{!logo.available
					? "The platform service is not connected to Coder's database, so a logo cannot be stored."
					: logo.set && logo.type && logo.bytes !== null
						? `${logo.type.replace("image/", "").toUpperCase()}, ${formatBytes(logo.bytes)} · uploaded by ${logo.updatedBy ?? "unknown"}${logo.updatedAt ? ` on ${new Date(logo.updatedAt).toLocaleString("en-US")}` : ""}`
						: "No custom logo: the default logo is shown."}
			</p>
			<div className="mt-4 flex flex-wrap gap-3">
				<Button disabled={!logo.available} onClick={onUpload}>
					Upload a new logo…
				</Button>
				{logo.set && (
					<Button variant="outline" onClick={onReset}>
						Restore the default logo
					</Button>
				)}
			</div>
			<p className="m-0 mt-4 text-sm text-content-secondary">
				Stored in Coder's own PostgreSQL database, so it survives restarts and
				upgrades. Everyone sees it after their next page load.
			</p>
		</section>
	);
};

type LogoPreviewProps = {
	theme: "dark" | "light";
	src: string | null;
	caption: string;
	signIn?: boolean;
};

/** How the logo looks in the navigation bar (or on the sign-in page) of a theme. */
const LogoPreview: React.FC<LogoPreviewProps> = ({
	theme,
	src,
	caption,
	signIn = false,
}) => (
	<figure className="m-0">
		<div
			className={cn(
				theme,
				"flex rounded-md border border-solid border-border bg-surface-primary px-4 text-content-secondary",
				signIn
					? "h-32 flex-col items-center justify-center gap-3"
					: "h-[72px] items-center gap-4",
			)}
		>
			<img
				src={src || DEFAULT_LOGO_URL}
				alt="Logo"
				className={cn("max-w-[200px] object-contain", signIn ? "h-12" : "h-7")}
			/>
			<span className="text-sm">
				{signIn ? "Sign in to Coder" : "Workspaces · Templates"}
			</span>
		</div>
		<figcaption className="mt-1.5 text-xs text-content-secondary">
			{caption}
		</figcaption>
	</figure>
);

type PendingLogo = { file: File; image: NormalizedImage };

const LogoUploadDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const queryClient = useQueryClient();
	const upload = useMutation(uploadLogo(queryClient));
	const [pending, setPending] = useState<PendingLogo>();
	const [problem, setProblem] = useState<string>();

	const pick = async (file: File) => {
		setPending(undefined);
		setProblem(undefined);
		try {
			setPending({ file, image: await normalizeImage(file, LOGO_TARGET) });
		} catch (error) {
			setProblem(
				`${file.name}: ${error instanceof ImageNormalizeError ? error.message : "this browser cannot read it as a picture."}`,
			);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !upload.isPending) {
					onClose();
				}
			}}
		>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Upload a new logo</DialogTitle>
					<DialogDescription>
						PNG, JPEG, SVG, WebP, GIF or AVIF; animated ones stay animated. It
						is resized for you to fit 512 × 256, so it looks the same
						everywhere. A wide logo about 3 to 4 times as wide as it is tall
						works best.
					</DialogDescription>
				</DialogHeader>
				<FileUpload
					isUploading={false}
					file={pending?.file}
					extensions={LOGO_EXTENSIONS}
					title="Choose an image or drop it here"
					removeLabel="Choose another image"
					onUpload={(file) => {
						void pick(file);
					}}
					onUnsupportedFile={(file) =>
						setProblem(
							`${file.name}: not a PNG, JPEG, SVG, WebP, GIF or AVIF image.`,
						)
					}
					onRemove={() => setPending(undefined)}
				/>
				{pending && (
					<div className="grid gap-4 sm:grid-cols-3">
						<LogoPreview
							theme="dark"
							src={pending.image.dataURL}
							caption="Navigation bar (dark)"
						/>
						<LogoPreview
							theme="light"
							src={pending.image.dataURL}
							caption="Navigation bar (light)"
						/>
						<LogoPreview
							theme="dark"
							src={pending.image.dataURL}
							caption="Sign-in page"
							signIn
						/>
					</div>
				)}
				{pending && (
					<p className="m-0 text-xs text-content-secondary">
						{pending.image.width
							? `Resized to ${pending.image.width} × ${pending.image.height}`
							: "Kept as uploaded"}
						{pending.image.frames > 1 ? `, ${pending.image.frames} frames` : ""}
						, {pending.image.type.replace("image/", "").toUpperCase()},{" "}
						{formatBytes(pending.image.bytes)}.
					</p>
				)}
				{problem && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{problem}
					</p>
				)}
				{upload.error ? <ErrorAlert error={upload.error} /> : null}
				<DialogFooter className="gap-2">
					<Button
						variant="outline"
						disabled={upload.isPending}
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button
						disabled={!pending || upload.isPending}
						onClick={() => {
							if (!pending) {
								return;
							}
							upload.mutate(pending.image.dataURL, {
								onSuccess: ({ url }) => {
									setLogoURL(url);
									toast.success("Logo saved.");
									onClose();
								},
							});
						}}
					>
						<Spinner loading={upload.isPending} />
						Save logo
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default CustomizeSettingsPage;
