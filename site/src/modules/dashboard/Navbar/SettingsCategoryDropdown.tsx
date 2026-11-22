import { arrayMove } from "@dnd-kit/sortable";
import { ScanEyeIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link, NavLink, useMatch } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	orderCategories,
	SortableCategories,
} from "#/modules/management/SortableCategories";
import type { AdminPage } from "./adminQuickLinks";
import { BreadcrumbDropdownContent } from "./BreadcrumbMenu";

export function SettingsCategoryDropdown({
	categories,
	quickLinks,
	hud,
}: {
	categories: readonly AdminPage[];
	quickLinks: readonly AdminPage[];
	hud: boolean;
}) {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(client));
	const settingsSection = useMatch("/settings/*");
	const profile = useMatch("/settings/account");
	const pages = [
		{
			id: "user-settings",
			label: "User Settings",
			path: "/settings/account",
			icon: SettingsIcon,
		},
		{
			id: "profile",
			label: "Profile",
			path: "/settings/account",
			icon: UserRoundIcon,
		},
		...(hud
			? [{ id: "hud", label: "HUD", path: "/hud", icon: ScanEyeIcon }]
			: []),
		...new Map(
			[...quickLinks, ...categories].map((page) => [page.id, page]),
		).values(),
	];
	const saved = preferences.data?.settings_category_order;
	const order = saved ?? pages.map(({ id }) => id);
	const visible = pages.map(({ id, label }) => ({ id, label, node: null }));
	const orderedIds = orderCategories(visible, order).map(({ id }) => id);

	const reorder = (ids: string[]) => {
		if (save.isPending) return;
		const hidden = saved?.filter((id) => !orderedIds.includes(id)) ?? [];
		save.mutate(
			{ settings_category_order: ids.length ? [...ids, ...hidden] : [] },
			{
				onError: (error) =>
					toast.error(
						getErrorMessage(error, "Could not save the category order."),
					),
			},
		);
	};

	return (
		<BreadcrumbDropdownContent
			aria-label="Settings categories"
			aria-labelledby={undefined}
		>
			<SortableCategories
				dropdown
				header={
					<span className="pl-2 text-xs font-medium text-content-secondary">
						Categories
					</span>
				}
				order={order}
				onReorder={reorder}
				categories={pages.map(({ id, label, path, icon: Icon }) => ({
					id,
					label,
					node: (
						<DropdownMenuItem
							asChild
							aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
							onKeyDown={(event) => {
								if (
									!event.altKey ||
									(event.key !== "ArrowUp" && event.key !== "ArrowDown")
								)
									return;
								event.preventDefault();
								event.stopPropagation();
								const from = orderedIds.indexOf(id);
								const to = from + (event.key === "ArrowUp" ? -1 : 1);
								if (to >= 0 && to < orderedIds.length)
									reorder(arrayMove(orderedIds, from, to));
							}}
						>
							{id === "user-settings" ? (
								<Link
									to={path}
									aria-current={
										settingsSection && !profile ? "page" : undefined
									}
								>
									<Icon aria-hidden />
									<span className="truncate">{label}</span>
								</Link>
							) : (
								<NavLink to={path} end={id === "hud" || id === "profile"}>
									<Icon aria-hidden />
									<span className="truncate">{label}</span>
								</NavLink>
							)}
						</DropdownMenuItem>
					),
				}))}
			/>
		</BreadcrumbDropdownContent>
	);
}
