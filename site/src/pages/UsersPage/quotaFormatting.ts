/** Formats quota quantities without insignificant trailing zeroes. */
export const formatQuotaNumber = (value: number): string => {
	if (!Number.isFinite(value)) {
		return "0";
	}
	const fixed =
		value >= 100
			? value.toFixed(0)
			: value >= 10
				? value.toFixed(1)
				: value.toFixed(2);
	return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** Distinct, stable colours for each user's share of the cluster. */
export const quotaUserColor = (index: number) =>
	`hsl(${(index * 137.508) % 360} 65% 55%)`;
