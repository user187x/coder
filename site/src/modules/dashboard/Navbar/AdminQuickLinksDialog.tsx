import { useId, useState } from "react";
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
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	ADMIN_QUICK_LINK_SLOTS,
	type AdminPage,
	DEFAULT_ADMIN_QUICK_LINKS,
} from "./adminQuickLinks";

type AdminQuickLinksDialogProps = {
	/** The pages this admin can pick from. */
	pages: readonly AdminPage[];
	/** The page in each slot now. */
	current: readonly (AdminPage | undefined)[];
	isSaving: boolean;
	error: unknown;
	onSave: (ids: string[]) => void;
	onClose: () => void;
};

const GROUPS = ["General", "Health"] as const;

/** Picks the admin page each of the Admin menu's quick links opens. */
export const AdminQuickLinksDialog: React.FC<AdminQuickLinksDialogProps> = ({
	pages,
	current,
	isSaving,
	error,
	onSave,
	onClose,
}) => {
	const [ids, setIds] = useState<string[]>(() =>
		Array.from(
			{ length: ADMIN_QUICK_LINK_SLOTS },
			(_, i) => current[i]?.id ?? "",
		),
	);
	const idPrefix = useId();
	const defaults = DEFAULT_ADMIN_QUICK_LINKS.map((id) =>
		pages.some((page) => page.id === id) ? id : "",
	);
	const complete = ids.every((id) => id !== "");

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !isSaving) {
					onClose();
				}
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Customize quick links</DialogTitle>
					<DialogDescription>
						Choose the admin pages the Admin menu opens directly. Only you see
						these.
					</DialogDescription>
				</DialogHeader>

				<form
					id={`${idPrefix}-form`}
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (complete) {
							onSave(ids);
						}
					}}
				>
					{ids.map((id, slot) => (
						<div key={slot} className="flex flex-col gap-1.5">
							<Label htmlFor={`${idPrefix}-${slot}`}>
								Quick link {slot + 1}
							</Label>
							<Select
								value={id}
								onValueChange={(value) =>
									setIds((prev) =>
										prev.map((other, i) =>
											i === slot ? value : other === value ? prev[slot] : other,
										),
									)
								}
							>
								<SelectTrigger id={`${idPrefix}-${slot}`}>
									<SelectValue placeholder="Choose a page" />
								</SelectTrigger>
								<SelectContent>
									{GROUPS.map((group) => {
										const groupPages = pages.filter(
											(page) => page.group === group,
										);
										return (
											groupPages.length > 0 && (
												<SelectGroup key={group}>
													<SelectLabel>{group}</SelectLabel>
													{groupPages.map((page) => (
														<SelectItem key={page.id} value={page.id}>
															{page.label}
														</SelectItem>
													))}
												</SelectGroup>
											)
										);
									})}
								</SelectContent>
							</Select>
						</div>
					))}
				</form>
				{error ? <ErrorAlert error={error} /> : null}

				<DialogFooter className="gap-2 sm:justify-between">
					<Button
						variant="subtle"
						disabled={isSaving}
						onClick={() =>
							setIds(
								Array.from(
									{ length: ADMIN_QUICK_LINK_SLOTS },
									(_, i) => defaults[i] ?? "",
								),
							)
						}
					>
						Restore defaults
					</Button>
					<div className="flex gap-2">
						<Button variant="outline" disabled={isSaving} onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							form={`${idPrefix}-form`}
							disabled={!complete || isSaving}
						>
							<Spinner loading={isSaving} />
							Save
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
