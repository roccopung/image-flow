import { error } from '@sveltejs/kit';
import { SANITY_DATASET, SANITY_PROJECT_ID } from '$app/env/private';
import type { PageServerLoad } from './$types';

export type Item = { _key: string; x: number; y: number; w: number; h: number; url: string };

const QUERY = `*[_id == "settings"][0].canvas->{
	"width": coalesce(width, 1500),
	"height": coalesce(height, 1500),
	"items": items[defined(image.asset)]{_key, x, y, w, h, "url": image.asset->url}
}`;

export const load: PageServerLoad = async () => {
	const api = `https://${SANITY_PROJECT_ID}.apicdn.sanity.io/v2026-11-01/data/query/${SANITY_DATASET}`;
	const response = await fetch(`${api}?query=${encodeURIComponent(QUERY)}`);
	if (!response.ok) error(502, 'Canvas unavailable');
	const { result } = await response.json();
	return {
		width: (result?.width ?? 1500) as number,
		height: (result?.height ?? 1500) as number,
		items: ((result?.items ?? []) as Item[]).filter((item) => item.url)
	};
};
