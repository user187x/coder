import type { FormikProps } from "formik";
import { useEffect, useEffectEvent } from "react";

/** A form follows what it was made from (the workspace refetched, the icons loaded) while nothing in it is changed. */
export const useFollowWhileClean = <T>(form: FormikProps<T>, initial: T) => {
	const key = JSON.stringify(initial);
	const follow = useEffectEvent(() => {
		if (!form.dirty && JSON.stringify(form.initialValues) !== key) {
			form.resetForm({ values: initial });
		}
	});
	useEffect(() => {
		follow();
	}, [key]);
};
