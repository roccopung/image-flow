import { building } from '$app/env';
import { defineEnvVars } from '@sveltejs/kit/env';

const required = (value: string | undefined) => {
	if (!value && !building) throw new Error('required');
	return value ?? '';
};

export const variables = defineEnvVars({
	SANITY_PROJECT_ID: { description: 'Sanity project ID', schema: required },
	SANITY_DATASET: { description: 'Sanity dataset (published content only)', schema: required }
});
