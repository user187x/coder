export type Branding = Readonly<{
	featureStage: Readonly<{
		background: string;
		divider: string;
		border: string;
		text: string;

		hover: Readonly<{
			background: string;
			divider: string;
			border: string;
			text: string;
		}>;
	}>;
}>;
