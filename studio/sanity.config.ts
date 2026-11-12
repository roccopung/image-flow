import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { media } from 'sanity-plugin-media';
import { canvasTool } from './src/canvas/tool';
import { schemaTypes } from './src/schema';

const projectId = process.env.SANITY_STUDIO_PROJECT_ID!;
const dataset = process.env.SANITY_STUDIO_DATASET!;

export default defineConfig({
	name: 'default',
	title: 'Image Wall',
	projectId,
	dataset,
	plugins: [
		media(),
		structureTool({
			structure: (S) =>
				S.list()
					.title('Content')
					.items(S.documentTypeListItems().filter((item) => !['media.tag', 'settings'].includes(item.getId()!)))
		})
	],
	tools: (prev) => [canvasTool, ...prev],
	schema: { types: schemaTypes }
});
