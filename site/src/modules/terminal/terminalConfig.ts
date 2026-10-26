import type {
	DeploymentConfig,
	UserAppearanceSettings,
} from "#/api/typesGenerated";
import { DEFAULT_TERMINAL_FONT, terminalFonts } from "#/theme/constants";

export function getTerminalConfig(
	config: DeploymentConfig | undefined,
	appearance: UserAppearanceSettings | undefined,
	proxyPathAppURL: string | undefined,
) {
	return {
		renderer: config?.config?.web_terminal_renderer,
		baseUrl:
			process.env.NODE_ENV !== "development" ? proxyPathAppURL : undefined,
		fontFamily:
			terminalFonts[appearance?.terminal_font || DEFAULT_TERMINAL_FONT],
	};
}

/** Explicit renderer selection otherwise follows the deployment's default terminal. */
export function terminalRenderer(
	configured: string | undefined,
	_agent: { apps?: readonly { slug: string }[] } | undefined,
	asked?: string | null,
): string | undefined {
	return asked === "ghostty" ? "ghostty" : configured;
}
