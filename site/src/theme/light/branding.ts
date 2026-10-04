import type { Branding } from "../branding";
import colors from "../tailwindColors";

const branding: Branding = {
	featureStage: {
		background: colors.sky[50],
		divider: colors.sky[100],
		border: colors.sky[700],
		text: colors.sky[700],

		hover: {
			background: colors.white,
			divider: colors.zinc[100],
			border: colors.sky[700],
			text: colors.sky[700],
		},
	},
};

export default branding;
