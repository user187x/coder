import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import { buildInfo } from "#/api/queries/buildInfo";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Spinner } from "#/components/Spinner/Spinner";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import {
	quickMenuKey,
	useQuickMenu,
} from "#/modules/platform/radialMenu/quickMenu";
import { Wheel } from "#/modules/platform/radialMenu/Wheel";
import {
	WHEEL_WEDGES,
	type WheelChoice,
	wheelChoices,
	wheelOf,
} from "#/modules/platform/radialMenu/wheelChoices";
import { pageTitle } from "#/utils/page";

const GROUP_LABEL: Record<WheelChoice["group"], string> = {
	dashboard: "Dashboard",
	admin: "Admin category",
};

/**
 * Platform: Admin Settings > Quick Menu - the wedges of the quick access wheel Escape opens on every page: which
 * choices (the dashboard's pages and every admin category), in what order (clockwise from the top), 3 to 12 of them.
 * Everyone gets the same wheel; a page someone may not open shows dimmed for them. A live preview beside the list.
 */
const QuickMenuSettingsPage: React.FC = () => {
	const queryClient = useQueryClient();
	const menu = useQuickMenu();
	const { permissions } = useAuthenticated();
	const { metadata } = useEmbeddedMetadata();
	const build = useQuery(buildInfo(metadata["build-info"]));
	const access = {
		permissions,
		oauth2Provider: Boolean(build.data?.oauth2_provider),
	};
	const all = wheelChoices();
	const saved = wheelOf(menu.data?.items).map((choice) => choice.id);
	const [draft, setDraft] = useState<string[] | null>(null);
	const ids = draft ?? saved;
	const wedges = ids
		.map((id) => all.find((choice) => choice.id === id))
		.filter((choice): choice is WheelChoice => Boolean(choice));
	const changed = draft !== null && draft.join() !== saved.join();
	const addable = all.filter((choice) => !ids.includes(choice.id));

	const onSaved = (message: string) => (data: unknown) => {
		queryClient.setQueryData(quickMenuKey, data);
		setDraft(null);
		toast.success(message);
	};
	const save = useMutation({
		mutationFn: () => PlatformAPI.saveQuickMenu(ids),
		onSuccess: onSaved("Saved: everyone's Quick Menu has these wedges now."),
		onError: (error) =>
			toast.error(getErrorMessage(error, "The Quick Menu was not saved.")),
	});
	const reset = useMutation({
		mutationFn: PlatformAPI.resetQuickMenu,
		onSuccess: onSaved("The Quick Menu is back to its default wedges."),
		onError: (error) =>
			toast.error(getErrorMessage(error, "The Quick Menu was not reset.")),
	});
	const busy = save.isPending || reset.isPending;

	const edit = (next: string[]) => setDraft(next);
	const moveWedge = (from: number, by: number) => {
		const next = [...ids];
		const [one] = next.splice(from, 1);
		next.splice(from + by, 0, one);
		edit(next);
	};

	return (
		<>
			<title>{pageTitle("Quick Menu")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Quick Menu</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					The wheel Escape opens on every page. Choose its wedges - the
					dashboard's pages and every admin category - and their order,
					clockwise from the top. Everyone gets this wheel; a page someone may
					not open shows dimmed for them.
				</SettingsHeaderDescription>
			</SettingsHeader>

			{menu.isLoading ? (
				<Loader />
			) : (
				<div className="flex flex-wrap items-start gap-8">
					<section
						aria-label="Preview"
						className="flex w-full max-w-[380px] flex-col items-center gap-2 rounded-2xl border border-solid border-border bg-[#0b0d12] p-4"
						data-testid="quick-menu-preview"
					>
						<Wheel
							items={wedges.map((choice) => ({
								id: choice.id,
								name: choice.label,
								icon: choice.icon,
								allowed: choice.allowed(access),
								why: "Admins only",
							}))}
							testIdPrefix="quick-menu-preview"
							className="quick-menu-preview-wheel"
						/>
						<span className="text-xs text-[#9ca3af]">
							Preview: point at a wedge
						</span>
					</section>

					<section
						aria-labelledby="quick-menu-wedges"
						className="flex min-w-[300px] flex-1 flex-col gap-3"
					>
						<div className="flex items-center justify-between gap-3">
							<h2
								id="quick-menu-wedges"
								className="m-0 text-base font-semibold"
							>
								Wedges
							</h2>
							<span className="text-sm text-content-secondary">
								{ids.length} of {WHEEL_WEDGES.least} to {WHEEL_WEDGES.most}
							</span>
						</div>
						{menu.error ? <ErrorAlert error={menu.error} /> : null}
						<ol
							className="m-0 flex list-none flex-col gap-1.5 p-0"
							data-testid="quick-menu-list"
						>
							{wedges.map((choice, i) => {
								const Icon = choice.icon;
								return (
									<li
										key={choice.id}
										className="flex items-center gap-3 rounded-xl border border-solid border-border bg-surface-primary px-3 py-2"
										data-testid={`quick-menu-wedge-${choice.id}`}
									>
										<span className="w-5 text-right font-mono text-xs text-content-secondary">
											{i + 1}
										</span>
										<Icon aria-hidden className="size-4 shrink-0" />
										<span className="flex-1 text-sm font-medium">
											{choice.label}
										</span>
										<span
											className={cn(
												"rounded-full border border-solid px-2 text-[11px]",
												choice.group === "admin"
													? "border-border-sky text-highlight-sky"
													: "border-border text-content-secondary",
											)}
										>
											{GROUP_LABEL[choice.group]}
										</span>
										<Button
											size="icon"
											variant="subtle"
											aria-label={`Move ${choice.label} up`}
											disabled={busy || i === 0}
											onClick={() => moveWedge(i, -1)}
										>
											<ArrowUpIcon />
										</Button>
										<Button
											size="icon"
											variant="subtle"
											aria-label={`Move ${choice.label} down`}
											disabled={busy || i === wedges.length - 1}
											onClick={() => moveWedge(i, 1)}
										>
											<ArrowDownIcon />
										</Button>
										<Button
											size="icon"
											variant="subtle"
											aria-label={`Take ${choice.label} off the wheel`}
											disabled={busy || ids.length <= WHEEL_WEDGES.least}
											onClick={() => edit(ids.filter((id) => id !== choice.id))}
										>
											<XIcon />
										</Button>
									</li>
								);
							})}
						</ol>

						<div className="flex flex-wrap items-center gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="outline"
										disabled={
											busy ||
											ids.length >= WHEEL_WEDGES.most ||
											addable.length === 0
										}
										data-testid="quick-menu-add"
									>
										<PlusIcon />
										Add a wedge
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									className="max-h-[60vh] w-64 overflow-y-auto"
								>
									{(["dashboard", "admin"] as const).map((group, g) => {
										const list = addable.filter((c) => c.group === group);
										if (list.length === 0) {
											return null;
										}
										return (
											<div key={group}>
												{g > 0 && <DropdownMenuSeparator />}
												<DropdownMenuLabel>
													{group === "admin" ? "Admin categories" : "Dashboard"}
												</DropdownMenuLabel>
												{list.map((choice) => {
													const Icon = choice.icon;
													return (
														<DropdownMenuItem
															key={choice.id}
															data-testid={`quick-menu-add-${choice.id}`}
															onSelect={() => edit([...ids, choice.id])}
														>
															<Icon aria-hidden />
															{choice.label}
														</DropdownMenuItem>
													);
												})}
											</div>
										);
									})}
								</DropdownMenuContent>
							</DropdownMenu>
							<div className="ml-auto flex flex-wrap gap-2">
								{menu.data?.items && (
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => reset.mutate()}
										data-testid="quick-menu-reset"
									>
										<Spinner loading={reset.isPending} />
										Reset to default
									</Button>
								)}
								{changed && (
									<Button
										variant="subtle"
										disabled={busy}
										onClick={() => setDraft(null)}
									>
										Discard
									</Button>
								)}
								<Button
									disabled={busy || !changed}
									onClick={() => save.mutate()}
									data-testid="quick-menu-save"
								>
									<Spinner loading={save.isPending} />
									Save
								</Button>
							</div>
						</div>
						{menu.data?.updatedBy && menu.data.items && (
							<p className="m-0 text-xs text-content-secondary">
								Arranged by {menu.data.updatedBy}
							</p>
						)}
					</section>
				</div>
			)}
		</>
	);
};

export default QuickMenuSettingsPage;
