import { ImagesIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { type TemplateIcon, templateIconPath } from "#/api/platform";
import {
	deleteTemplateIcon,
	templateIcons,
	uploadTemplateIcon,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { FileUpload } from "#/components/FileUpload/FileUpload";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { formatBytes } from "../images";
import {
	ICON_TARGET,
	ImageNormalizeError,
	type NormalizedImage,
	normalizeImage,
} from "../normalizeImage";

const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp", "gif", "avif"];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A name for an icon from its file name: lower case, safe characters, no extension. */
export const iconNameFromFile = (fileName: string): string =>
	fileName
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[^a-z0-9]+|-+$/g, "")
		.slice(0, 64);

/** "Icons" on the Templates page: opens the icon library. */
export const TemplateIconsButton: React.FC = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button size="lg" variant="outline" onClick={() => setOpen(true)}>
				<ImagesIcon />
				Icons
			</Button>
			{open && <TemplateIconsDialog onClose={() => setOpen(false)} />}
		</>
	);
};

type PendingIcon = { file: File; image: NormalizedImage };

/**
 * Templates > Icons: pictures uploaded to Coder's database and served at
 * /__coder-ui/icons/<name>, for template, workspace and Terraform resource
 * icons (`icon = "/__coder-ui/icons/<name>"`), and in every icon picker.
 * Owners and template admins add and remove them; everyone can copy a path.
 */
export const TemplateIconsDialog: React.FC<{ onClose: () => void }> = ({
	onClose,
}) => {
	const queryClient = useQueryClient();
	const iconsQuery = useQuery(templateIcons());
	const upload = useMutation(uploadTemplateIcon(queryClient));
	const remove = useMutation(deleteTemplateIcon(queryClient));
	const [pending, setPending] = useState<PendingIcon>();
	const [name, setName] = useState("");
	const [problem, setProblem] = useState<string>();
	const [deleting, setDeleting] = useState<TemplateIcon>();
	const nameId = useId();

	const icons = iconsQuery.data?.icons ?? [];
	const canManage = iconsQuery.data?.canManage ?? false;
	const nameValid = NAME_RE.test(name);
	const replacing = icons.some((icon) => icon.name === name);

	const pick = async (file: File) => {
		setProblem(undefined);
		setPending(undefined);
		try {
			const image = await normalizeImage(file, ICON_TARGET);
			setPending({ file, image });
			setName(iconNameFromFile(file.name));
		} catch (error) {
			setProblem(
				`${file.name}: ${error instanceof ImageNormalizeError ? error.message : "this browser cannot read it as a picture."}`,
			);
		}
	};

	const save = () => {
		if (!pending || !nameValid) {
			return;
		}
		upload.mutate(
			{ name, dataUrl: pending.image.dataURL },
			{
				onSuccess: () => {
					toast.success(`Icon ${name} saved.`);
					setPending(undefined);
					setName("");
				},
			},
		);
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
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Icons</DialogTitle>
					<DialogDescription>
						Pictures for templates, workspaces and Terraform resources, stored
						in Coder's database. Use one with its path, for example{" "}
						<code>icon = "{templateIconPath("my-tool")}"</code>; they also
						appear in every icon picker.
					</DialogDescription>
				</DialogHeader>

				{iconsQuery.isLoading ? (
					<Loader />
				) : iconsQuery.error ? (
					<ErrorAlert error={iconsQuery.error} />
				) : (
					<>
						{canManage && (
							<section
								aria-label="Add an icon"
								className="flex flex-col gap-3 rounded-lg border border-solid border-border p-4"
							>
								<FileUpload
									isUploading={upload.isPending}
									file={pending?.file}
									extensions={ICON_EXTENSIONS}
									title="Choose an image or drop it here"
									description="PNG, JPEG, SVG, WebP, GIF or AVIF; animated ones stay animated. It is resized to fit 256 × 256."
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
									<form
										className="flex flex-wrap items-end gap-4"
										onSubmit={(event) => {
											event.preventDefault();
											save();
										}}
									>
										<img
											src={pending.image.dataURL}
											alt=""
											className="size-12 rounded-md border border-solid border-border object-contain p-1"
										/>
										<div className="flex min-w-60 flex-1 flex-col gap-1.5">
											<Label htmlFor={nameId}>Name</Label>
											<Input
												id={nameId}
												value={name}
												aria-invalid={!nameValid}
												onChange={(event) =>
													setName(event.target.value.toLowerCase())
												}
											/>
											<span className="text-xs text-content-secondary">
												{!nameValid
													? "Lower-case letters, digits, '.', '-' and '_'."
													: replacing
														? `Replaces the icon ${name}.`
														: `Path: ${templateIconPath(name)}`}
											</span>
										</div>
										<Button
											type="submit"
											disabled={!nameValid || upload.isPending}
										>
											<Spinner loading={upload.isPending} />
											{replacing ? "Replace icon" : "Save icon"}
										</Button>
									</form>
								)}
								{problem && (
									<p
										role="alert"
										className="m-0 text-sm text-content-destructive"
									>
										{problem}
									</p>
								)}
								{upload.error ? <ErrorAlert error={upload.error} /> : null}
							</section>
						)}

						{icons.length ? (
							<ul
								aria-label="Uploaded icons"
								className="m-0 grid max-h-[50vh] list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 overflow-y-auto p-0"
							>
								{icons.map((icon) => (
									<li
										key={icon.name}
										className="flex items-center gap-3 rounded-md border border-solid border-border p-2"
									>
										<img
											src={icon.url}
											alt=""
											className="size-10 shrink-0 object-contain"
										/>
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-sm font-medium">
												{icon.name}
											</span>
											<span className="truncate text-xs text-content-secondary">
												{icon.type.replace("image/", "").toUpperCase()},{" "}
												{formatBytes(icon.bytes)}
											</span>
										</div>
										<CopyButton
											text={templateIconPath(icon.name)}
											label={`Copy the path of ${icon.name}`}
										/>
										{canManage && (
											<Button
												size="icon"
												variant="subtle"
												aria-label={`Delete ${icon.name}`}
												onClick={() => setDeleting(icon)}
											>
												<Trash2Icon />
											</Button>
										)}
									</li>
								))}
							</ul>
						) : (
							<p className="m-0 text-sm text-content-secondary">
								No icons uploaded yet.
								{canManage ? " Add the first one above." : ""}
							</p>
						)}
					</>
				)}

				<ConfirmDialog
					type="delete"
					open={deleting !== undefined}
					title="Delete this icon?"
					description={`Templates and workspaces that use ${deleting ? templateIconPath(deleting.name) : "it"} show no icon until it is uploaded again.`}
					confirmText="Delete"
					confirmLoading={remove.isPending}
					onClose={() => setDeleting(undefined)}
					onConfirm={() =>
						deleting &&
						remove.mutate(deleting.name, {
							onSuccess: () => {
								toast.success(`Icon ${deleting.name} deleted.`);
								setDeleting(undefined);
							},
							onError: (error) => {
								toast.error(
									getErrorMessage(error, "The icon could not be deleted."),
								);
							},
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
};
