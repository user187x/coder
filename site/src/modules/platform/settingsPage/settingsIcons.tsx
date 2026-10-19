/**
 * The workspace settings page's icons: the design's own stroke glyphs (24×24, round caps), so the page matches it
 * exactly. Each takes its size and stroke width where it is used; the colour is the text's.
 */
type GlyphProps = {
	size?: number;
	strokeWidth?: number;
	className?: string;
	style?: React.CSSProperties;
};

const glyph =
	(paths: React.ReactNode, defaults: { size: number; strokeWidth: number }) =>
	({
		size = defaults.size,
		strokeWidth = defaults.strokeWidth,
		className,
		style,
	}: GlyphProps) => (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
			style={style}
		>
			{paths}
		</svg>
	);

const nav = { size: 16, strokeWidth: 1.8 };
const small = { size: 14, strokeWidth: 2 };

export const TerminalGlyph = glyph(
	<>
		<rect x="3" y="4" width="18" height="16" rx="3" />
		<path d="M7 9l3 3-3 3" />
		<path d="M12 15h5" />
	</>,
	{ size: 22, strokeWidth: 1.8 },
);

export const CopyGlyph = glyph(
	<>
		<rect x="9" y="9" width="11" height="11" rx="2" />
		<path d="M5 15V6a2 2 0 0 1 2-2h9" />
	</>,
	{ size: 15, strokeWidth: 1.8 },
);

export const CheckGlyph = glyph(<path d="M5 12.5l4.5 4.5L19 7.5" />, {
	size: 15,
	strokeWidth: 2,
});

export const GearGlyph = glyph(
	<>
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
	</>,
	nav,
);

export const ChipGlyph = glyph(
	<>
		<rect x="5" y="5" width="14" height="14" rx="2" />
		<rect x="9" y="9" width="6" height="6" />
		<path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
	</>,
	nav,
);

export const MonitorGlyph = glyph(
	<>
		<rect x="2" y="4" width="20" height="13" rx="2" />
		<path d="M8 21h8M12 17v4" />
	</>,
	nav,
);

export const ClockGlyph = glyph(
	<>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" />
	</>,
	nav,
);

export const PeopleGlyph = glyph(
	<>
		<circle cx="9" cy="8" r="3.5" />
		<path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
		<path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
	</>,
	nav,
);

export const IdCardGlyph = glyph(
	<>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<circle cx="9" cy="11" r="2" />
		<path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h3" />
	</>,
	{ size: 18, strokeWidth: 1.8 },
);

export const LockGlyph = glyph(
	<>
		<rect x="5" y="11" width="14" height="10" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</>,
	nav,
);

export const UploadGlyph = glyph(
	<path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
	small,
);

export const SmileGlyph = glyph(
	<>
		<circle cx="12" cy="12" r="9" />
		<path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
	</>,
	small,
);

export const ResetGlyph = glyph(
	<>
		<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
		<path d="M3 3v5h5" />
	</>,
	small,
);

export const RestartGlyph = glyph(
	<>
		<path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
		<path d="M21 3v5h-5" />
	</>,
	{ size: 13, strokeWidth: 2 },
);

export const GpuGlyph = glyph(
	<>
		<rect x="2" y="6" width="20" height="11" rx="2" />
		<circle cx="15" cy="11.5" r="2.5" />
		<path d="M6 10h4M6 13h4M5 17v2M9 17v2" />
	</>,
	{ size: 18, strokeWidth: 1.8 },
);

export const DiskGlyph = glyph(
	<>
		<ellipse cx="12" cy="6" rx="8" ry="3" />
		<path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
		<path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
	</>,
	{ size: 18, strokeWidth: 1.8 },
);

export const ExpandGlyph = glyph(
	<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
	small,
);

export const PackageGlyph = glyph(
	<>
		<path d="M21 8l-9-5-9 5 9 5 9-5z" />
		<path d="M3 8v8l9 5 9-5V8" />
		<path d="M12 13v8" />
	</>,
	{ size: 15, strokeWidth: 1.8 },
);

export const FolderGlyph = glyph(
	<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
	{ size: 15, strokeWidth: 1.8 },
);

export const PlayGlyph = glyph(<path d="M6 4l14 8-14 8z" />, {
	size: 15,
	strokeWidth: 2,
});

export const StopGlyph = glyph(
	<rect x="6" y="6" width="12" height="12" rx="2" />,
	{ size: 15, strokeWidth: 2 },
);

export const InfoGlyph = glyph(
	<>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5M12 8h.01" />
	</>,
	nav,
);

export const SearchGlyph = glyph(
	<>
		<circle cx="11" cy="11" r="7" />
		<path d="M20 20l-3.5-3.5" />
	</>,
	nav,
);

export const PlusGlyph = glyph(<path d="M12 5v14M5 12h14" />, small);

export const AddPersonGlyph = glyph(
	<>
		<circle cx="9" cy="8" r="3.5" />
		<path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
		<path d="M19 8v6M16 11h6" />
	</>,
	{ size: 22, strokeWidth: 1.8 },
);

export const TrashGlyph = glyph(
	<>
		<path d="M4 7h16M10 11v6M14 11v6" />
		<path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
	</>,
	nav,
);

export const TargetGlyph = glyph(
	<>
		<circle cx="12" cy="12" r="8" />
		<circle cx="12" cy="12" r="2.5" />
	</>,
	{ size: 22, strokeWidth: 1.6 },
);

// The template settings page's sections, drawn the same way.
export const ToggleGlyph = glyph(
	<>
		<rect x="2" y="4" width="20" height="7" rx="3.5" />
		<circle cx="7.5" cy="7.5" r="1.5" />
		<rect x="2" y="13" width="20" height="7" rx="3.5" />
		<circle cx="16.5" cy="16.5" r="1.5" />
	</>,
	nav,
);

export const PortGlyph = glyph(
	<>
		<path d="M9 7V3M15 7V3" />
		<path d="M6 7h12v4a6 6 0 0 1-12 0z" />
		<path d="M12 17v4" />
	</>,
	nav,
);

export const ArchiveGlyph = glyph(
	<>
		<rect x="3" y="4" width="18" height="4" rx="1" />
		<path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
		<path d="M10 12h4" />
	</>,
	nav,
);

export const BracesGlyph = glyph(
	<>
		<path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
		<path d="M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
	</>,
	nav,
);

export const ShieldGlyph = glyph(
	<>
		<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
		<path d="M9 12l2 2 4-4" />
	</>,
	nav,
);

export const SlidersGlyph = glyph(
	<>
		<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
		<circle cx="15" cy="6" r="2" />
		<circle cx="9" cy="12" r="2" />
		<circle cx="17" cy="18" r="2" />
	</>,
	nav,
);
