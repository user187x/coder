import type { Branding } from "../branding";
import colors from "../tailwindColors";

const branding: Branding = {
	featureStage: {
		background: colors.sky[950],
		divider: colors.sky[900],
		border: colors.sky[400],
		text: colors.sky[400],

		hover: {
			background: colors.zinc[950],
			divider: colors.zinc[900],
			border: colors.sky[400],
			text: colors.sky[400],
		},
	},
};

export default branding;
