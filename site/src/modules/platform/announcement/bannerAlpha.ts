// Platform: the announcement's opacity (Admin Settings > Announcement > Transparency).

/** The banner's opacity (percent, 20-100; none: 100) as a fraction. */
export const bannerAlpha = (opacity?: number) =>
	Math.min(Math.max((opacity || 100) / 100, 0.2), 1);

/** A colour at the banner's opacity: a background the page shows through, the text over it still solid. */
export const withBannerAlpha = (color: string, opacity?: number) => {
	const alpha = bannerAlpha(opacity);
	return alpha >= 1
		? color
		: `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
};
