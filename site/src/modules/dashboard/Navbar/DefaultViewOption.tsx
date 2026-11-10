import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";

/** A page the Default View can be: a plain path, as the user's preferences accept (no fragment or query). */
const settable = (path: string) => /^\/[a-z0-9][a-z0-9/_-]{0,127}$/.test(path);

/**
 * A quick link's right-click option: make its page the user's Default View (kept in their preferences), where the root
 * Settings crumb takes them; on the page that already is, it clears it.
 */
export const DefaultViewOption: React.FC<{ path: string }> = ({ path }) => {
	const view = useSettingsDefaultView();
	if (!settable(path)) return null;
	const current = view.path === path;
	return (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				view.set(current ? null : path);
			}}
		>
			{current ? "Clear Default View" : "Set Default View"}
		</DropdownMenuItem>
	);
};

/** The small orb, in the theme's link colour, to the right of the quick link that is the Default View. */
export const DefaultViewOrb: React.FC<{ path: string }> = ({ path }) => {
	const view = useSettingsDefaultView();
	if (view.path !== path) return null;
	return (
		<span
			role="img"
			aria-label="Default view"
			title="Default view"
			className="mx-1.5 size-2 shrink-0 rounded-full bg-content-link"
		/>
	);
};
