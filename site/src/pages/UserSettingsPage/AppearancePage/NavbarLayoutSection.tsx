import { ArrowLeftRightIcon, RotateCcwIcon } from "lucide-react";
import { useId } from "react";
import { useMutation, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	NAVBAR_LABELS,
	startNavbarArrange,
	useNavbarOrder,
} from "#/modules/platform/navbarOrder/navbarOrder";

/**
 * Appearance > Navigation bar: the top bar's order and hidden items, the arrange mode that changes them (the same one
 * the account menu's Rearrange top bar starts), and a reset to the default layout.
 */
export const NavbarLayoutSection: React.FC = () => {
	const id = useId();
	const client = useQueryClient();
	const { order, hidden } = useNavbarOrder();
	const reset = useMutation(updateUserUIPreferences(client));
	const shown = order.filter((item) => !hidden.includes(item));
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="mt-6 rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<h2 id={`${id}-title`} className="m-0 text-lg font-semibold">
				Navigation bar
			</h2>
			<p className="mt-0 mb-4 text-sm text-content-secondary">
				The order of the top bar's items, and which are hidden. Rearrange lets
				you drag them in place on the bar itself.
			</p>
			<dl className="m-0 mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<dt className="text-content-secondary">Order</dt>
				<dd className="m-0">
					{shown.map((item) => NAVBAR_LABELS[item]).join(", ") || "None"}
				</dd>
				<dt className="text-content-secondary">Hidden</dt>
				<dd className="m-0">
					{hidden.map((item) => NAVBAR_LABELS[item]).join(", ") || "None"}
				</dd>
			</dl>
			{reset.error ? <ErrorAlert error={reset.error} /> : null}
			<div className="flex flex-wrap gap-2">
				<Button onClick={() => startNavbarArrange()}>
					<ArrowLeftRightIcon />
					Rearrange top bar
				</Button>
				<Button
					variant="outline"
					disabled={reset.isPending}
					onClick={() =>
						reset.mutate(
							{ navbar_layout: null },
							{
								onSuccess: () =>
									void client.invalidateQueries({
										queryKey: userUIPreferences().queryKey,
									}),
							},
						)
					}
				>
					<RotateCcwIcon />
					Reset to default
				</Button>
			</div>
		</section>
	);
};
