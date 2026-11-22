import { MegaphoneIcon, SendIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { banner, publishBannerMessage } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { Label } from "#/components/Label/Label";
import { Textarea } from "#/components/Textarea/Textarea";
import { InlineMenuPanel, MenuLabel, useInlineMenu } from "./InlineMenu";

/** Right-click or Shift+F10 opens a quick editor without leaving the dropdown. */
export const AnnouncementMenuItem = ({
	className,
	labelBadge,
}: {
	className?: string;
	labelBadge?: React.ReactNode;
}) => {
	const menu = useInlineMenu();
	const [draft, setDraft] = useState<string | null>(null);
	const id = useId();
	const query = useQuery({ ...banner(false), enabled: menu.open });
	const save = useMutation(publishBannerMessage(useQueryClient()));
	const text = draft ?? query.data?.message ?? "";
	const close = () => {
		menu.close();
		setDraft(null);
		save.reset();
	};
	return (
		<>
			<DropdownMenuItem asChild className={className} {...menu.trigger}>
				<Link
					to="/deployment/announcement"
					title="Right-click to quickly update the announcement"
				>
					<MegaphoneIcon aria-hidden />
					{labelBadge ? (
						<MenuLabel badge={labelBadge}>Announcement</MenuLabel>
					) : (
						"Announcement"
					)}
				</Link>
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					label="Announcement options"
					className="order-last"
					quickLinkMenu={menu}
				>
					<form
						aria-label="Quick announcement"
						className="settings-compact-chat flex w-full flex-col gap-2 p-1"
						onKeyDown={(event) => event.stopPropagation()}
						onSubmit={(event) => {
							event.preventDefault();
							if (query.data && text.trim())
								save.mutate(text.trim(), {
									onSuccess: () => {
										toast.success("Announcement updated.");
										close();
									},
								});
						}}
					>
						<Label htmlFor={id}>Announcement text</Label>
						<Textarea
							id={id}
							autoFocus
							rows={3}
							maxLength={4000}
							value={text}
							onChange={(event) => setDraft(event.target.value)}
							disabled={save.isPending || query.isLoading}
							className="min-h-20 resize-y text-xs"
						/>
						<p className="m-0 text-xs text-content-secondary">
							Publishes immediately to{" "}
							{query.data?.audience === "selected"
								? "the selected recipients"
								: "everyone"}
							.
						</p>
						{query.isError && (
							<>
								<ErrorAlert error={query.error} />
								<Button
									type="button"
									size="sm"
									onClick={() => void query.refetch()}
								>
									Retry
								</Button>
							</>
						)}
						{save.isError && <ErrorAlert error={save.error} />}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={close}
								disabled={save.isPending}
							>
								<XIcon aria-hidden />
								Cancel
							</Button>
							<Button
								type="submit"
								size="sm"
								disabled={!query.data || !text.trim() || save.isPending}
							>
								<SendIcon aria-hidden />
								{save.isPending ? "Submitting…" : "Submit"}
							</Button>
						</div>
					</form>
				</InlineMenuPanel>
			)}
		</>
	);
};
