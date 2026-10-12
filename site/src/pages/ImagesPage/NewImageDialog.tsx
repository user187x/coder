import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { useNavigate } from "react-router";
import { getErrorMessage } from "#/api/errors";
import { type ImageBase, ImagesAPI } from "#/api/images";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { imagesKey } from "./ImagesPage";

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** "+ New Image": its name, what it is for, and what it starts from; then the builder. */
export const NewImageDialog: React.FC<{ onClose: () => void }> = ({
	onClose,
}) => {
	const navigate = useNavigate();
	const list = useQuery({ queryKey: imagesKey, queryFn: ImagesAPI.list });
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [base, setBase] = useState<string>("workspace");
	const create = useMutation({
		mutationFn: () => {
			const b: ImageBase =
				base === "workspace"
					? { kind: "workspace" }
					: { kind: "image", id: base };
			return ImagesAPI.create(name, description, b);
		},
		onSuccess: ({ image }) => navigate(`/images/${image.id}/edit`),
	});
	const valid = NAME_RE.test(name);
	const ready = (list.data?.images ?? []).filter((i) => i.pullRef);

	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !create.isPending && onClose()}
		>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>New Image</DialogTitle>
					<DialogDescription>
						Name it, then pick its packages, installations, hardening, desktop
						and configuration in the builder. Nothing is built until you say so.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex min-w-0 flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (valid) {
							create.mutate();
						}
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="image-name">Name</Label>
						<Input
							id="image-name"
							value={name}
							autoFocus
							placeholder="e.g. data-science"
							onChange={(e) =>
								setName(
									e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
								)
							}
						/>
						<span className="text-xs text-content-secondary">
							3–40 lowercase letters, digits and dashes. Templates use it as{" "}
							<code className="break-all">
								{list.data?.pullPrefix ?? "localhost:5000"}/coder-images/
								{name || "<name>"}:&lt;version&gt;
							</code>
							.
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="image-description">Description</Label>
						<Textarea
							id="image-description"
							rows={2}
							value={description}
							placeholder="What is it for? Who uses it?"
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="image-base">Starts from</Label>
						<select
							id="image-base"
							value={base}
							onChange={(e) => setBase(e.target.value)}
							className="h-10 w-full min-w-0 truncate rounded-md border border-solid border-border bg-surface-primary px-3 text-sm text-content-primary"
						>
							<option value="workspace">
								The workspace image: XFCE desktop, Firefox, tools
							</option>
							{ready.map((i) => (
								<option key={i.id} value={i.id}>
									{i.name} (v{i.version}), built here
								</option>
							))}
						</select>
						<span className="break-all font-mono text-xs text-content-secondary">
							{base === "workspace"
								? (list.data?.baseImage ?? "coder-workspace")
								: (ready.find((i) => i.id === base)?.pullRef ?? "")}
						</span>
					</div>
					{create.error ? (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{getErrorMessage(create.error, "The image could not be created.")}
						</p>
					) : null}
					<DialogFooter className="gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={create.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!valid || create.isPending}>
							<Spinner loading={create.isPending} />
							Open the builder
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
