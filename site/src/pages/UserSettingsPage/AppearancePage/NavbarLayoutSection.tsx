import { ArrowLeftRightIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import { Slider } from "#/components/Slider/Slider";
import { Switch } from "#/components/Switch/Switch";
import {
	NAVBAR_LABELS,
	startNavbarArrange,
	useNavbarOrder,
} from "#/modules/platform/navbarOrder/navbarOrder";

const DEFAULT_RADIUS = 10;

/**
 * Appearance > Navigation bar: the top bar's order and hidden items, the arrange mode that changes them (the same one
 * the account menu's Rearrange top bar starts), a reset to the default layout, and the backstrip behind the bar: its
 * corner radius, or none at all.
 */
export const NavbarLayoutSection: React.FC = () => {
	const id = useId();
	const client = useQueryClient();
	const { order, hidden } = useNavbarOrder();
	const reset = useMutation(updateUserUIPreferences(client));
	const save = useMutation(updateUserUIPreferences(client));
	const preferences = useQuery(userUIPreferences());
	const stripOff = Boolean(preferences.data?.navbar_strip_off);
	const savedRadius = preferences.data?.navbar_strip_radius ?? DEFAULT_RADIUS;
	const [radius, setRadius] = useState(savedRadius);
	useEffect(() => setRadius(savedRadius), [savedRadius]);
	const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(pending.current), []);
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
				you drag them in place on the bar itself. The backstrip is the band
				behind the bar.
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
			<div className="mb-4 flex flex-col gap-3">
				<div className="flex items-center gap-3">
					<Switch
						id={`${id}-strip`}
						checked={!stripOff}
						disabled={save.isPending || !preferences.isSuccess}
						onCheckedChange={(on) => save.mutate({ navbar_strip_off: !on })}
					/>
					<Label htmlFor={`${id}-strip`}>Backstrip</Label>
				</div>
				<div className="flex flex-col gap-2">
					<span id={`${id}-radius`} className="text-sm font-medium">
						Corner radius
					</span>
					<div className="flex items-center gap-3">
						<Slider
							className="w-56"
							min={0}
							max={24}
							step={1}
							value={[radius]}
							disabled={stripOff || !preferences.isSuccess}
							aria-labelledby={`${id}-radius`}
							onValueChange={([next]) => {
								if (next === undefined) return;
								setRadius(next);
								clearTimeout(pending.current);
								pending.current = setTimeout(
									() =>
										save.mutate({
											navbar_strip_radius:
												next === DEFAULT_RADIUS ? null : next,
										}),
									400,
								);
							}}
						/>
						<span className="w-12 text-sm tabular-nums text-content-secondary">
							{radius}px
						</span>
					</div>
				</div>
			</div>
			{reset.error || save.error ? (
				<ErrorAlert error={reset.error ?? save.error} />
			) : null}
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
