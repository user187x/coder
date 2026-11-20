import { cn } from "cn";

type MetricMeterProps = {
	label: string;
	value: number;
	max: number;
	valueText: string;
	reserved?: number;
	reverse?: boolean;
	useMetricColor?: boolean;
	className?: string;
	fillClassName: string;
};

const fillClass =
	"absolute inset-y-0 rounded transition-[width] duration-500 motion-reduce:transition-none";

/** A current reading above its history graph, scaled against its available range. */
export function MetricMeter({
	label,
	value,
	max,
	valueText,
	reserved,
	reverse = false,
	useMetricColor = true,
	className,
	fillClassName,
}: MetricMeterProps) {
	const upper = Math.max(0, max);
	const reading = Math.max(0, Math.min(upper, value));
	const widthOf = (amount: number) =>
		upper > 0 ? `${Math.max(0, Math.min(100, (100 * amount) / upper))}%` : "0%";
	return (
		<div
			data-panel-graph-track
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={upper}
			aria-valuenow={reading}
			aria-valuetext={valueText}
			title={valueText}
			className={cn(
				"relative h-2 overflow-hidden rounded bg-surface-tertiary",
				className,
			)}
		>
			{reserved !== undefined && (
				<div
					className={cn(fillClass, "left-0 bg-content-secondary/25")}
					style={{ width: widthOf(reserved) }}
				/>
			)}
			<div
				data-panel-graph-fill={useMetricColor ? "" : undefined}
				className={cn(fillClass, reverse ? "right-0" : "left-0", fillClassName)}
				style={{ width: widthOf(reading) }}
			/>
		</div>
	);
}
