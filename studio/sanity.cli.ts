import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineCliConfig } from 'sanity/cli';

export default defineCliConfig({
	api: { projectId: 'vuee6h2z', dataset: 'production' },
	studioHost: 'image-wall',
	deployment: { appId: 'r17yy1y4k7hpfb93wbs3sfkt' },
	vite: (config) => ({
		...config,
		plugins: [...(config.plugins ?? []), svelte({ compilerOptions: { runes: true } })]
	})
});
