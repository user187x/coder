// Types for the parts of gifenc (https://github.com/mattdesl/gifenc) the
// dashboard uses to re-encode animated logos and avatars.
declare module "gifenc" {
	type Palette = number[][];
	type PaletteFormat = "rgb565" | "rgb444" | "rgba4444";

	interface QuantizeOptions {
		format?: PaletteFormat;
		oneBitAlpha?: boolean | number;
		clearAlpha?: boolean;
		clearAlphaThreshold?: number;
		clearAlphaColor?: number;
	}

	interface WriteFrameOptions {
		palette?: Palette;
		delay?: number;
		repeat?: number;
		transparent?: boolean;
		transparentIndex?: number;
		dispose?: number;
	}

	interface Encoder {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			options?: WriteFrameOptions,
		): void;
		finish(): void;
		bytes(): Uint8Array;
	}

	export function GIFEncoder(): Encoder;
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		options?: QuantizeOptions,
	): Palette;
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: Palette,
		format?: PaletteFormat,
	): Uint8Array;
}
