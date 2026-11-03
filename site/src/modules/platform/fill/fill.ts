export type FillSettings = {
	name: "fill";
	mode: "solid" | "linear" | "radial";
	color: string;
	endColor: string;
	angle: number;
	start: number;
	end: number;
};

export const DEFAULT_FILL: FillSettings = {
	name: "fill",
	mode: "solid",
	color: "#0f172a",
	endColor: "#2563eb",
	angle: 135,
	start: 0,
	end: 100,
};

const bounded = (value: unknown, fallback: number, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
const color = (value: unknown, fallback: string) =>
	typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
		? value.toLowerCase()
		: fallback;

/** Normalize stored presets before using them in CSS, HTML or a canvas. */
export const fillSettings = (value?: Record<string, unknown>): FillSettings => {
	const start = bounded(value?.start, 0, 0, 99);
	return {
		name: "fill",
		mode:
			value?.mode === "linear" || value?.mode === "radial"
				? value.mode
				: "solid",
		color: color(value?.color, DEFAULT_FILL.color),
		endColor: color(value?.endColor, DEFAULT_FILL.endColor),
		angle: bounded(value?.angle, 135, 0, 360),
		start,
		end: bounded(value?.end, 100, start + 1, 100),
	};
};

export const fillCSS = (value: FillSettings): string => {
	const fill = fillSettings(value);
	const stops = `${fill.color} ${fill.start}%, ${fill.endColor} ${fill.end}%`;
	return fill.mode === "solid"
		? fill.color
		: fill.mode === "linear"
			? `linear-gradient(${fill.angle}deg, ${stops})`
			: `radial-gradient(circle, ${stops})`;
};

export const fillHTML = (value: FillSettings): string =>
	`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${fillCSS(value)}}</style></head><body></body></html>`;

/** Rasterize a fill for consumers that store images, such as logos and headings. */
export const fillFile = async (
	value: FillSettings,
	size = 256,
): Promise<File> => {
	const fill = fillSettings(value);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = Math.round(bounded(size, 256, 16, 1024));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("This browser cannot create an image.");
	const center = canvas.width / 2;
	let paint: string | CanvasGradient = fill.color;
	if (fill.mode === "linear") {
		const radians = (fill.angle * Math.PI) / 180;
		const x = Math.sin(radians);
		const y = -Math.cos(radians);
		const length = center * (Math.abs(x) + Math.abs(y));
		paint = context.createLinearGradient(
			center - x * length,
			center - y * length,
			center + x * length,
			center + y * length,
		);
	} else if (fill.mode === "radial") {
		paint = context.createRadialGradient(
			center,
			center,
			0,
			center,
			center,
			center * Math.SQRT2,
		);
	}
	if (typeof paint !== "string") {
		paint.addColorStop(fill.start / 100, fill.color);
		paint.addColorStop(fill.end / 100, fill.endColor);
	}
	context.fillStyle = paint;
	context.fillRect(0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob
					? resolve(blob)
					: reject(new Error("The image could not be created.")),
			"image/png",
		),
	);
	return new File([blob], `${fill.mode}-fill.png`, { type: "image/png" });
};
