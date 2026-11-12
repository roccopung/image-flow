<script lang="ts">
	import type { Asset } from './types';

	let { assets }: { assets: Asset[] } = $props();

	let query = $state('');

	const groups = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const map = new Map<string, Asset[]>();
		for (const asset of assets) {
			if (needle && !asset.name.toLowerCase().includes(needle)) continue;
			const group =
				asset.folder ?? (asset.name.includes('__') ? asset.name.split('__')[0] : 'Ungrouped');
			map.set(group, [...(map.get(group) ?? []), asset]);
		}
		return [...map].sort(([a], [b]) => a.localeCompare(b));
	});

	function onDragStart(event: DragEvent, asset: Asset) {
		event.dataTransfer?.setData('application/x-asset', asset._id);
	}
</script>

<div class="assets">
	<input type="search" placeholder="Search" bind:value={query} />
	{#each groups as [group, list] (group)}
		<details open>
			<summary>{group} <span>{list.length}</span></summary>
			<ul>
				{#each list as asset (asset._id)}
					<li>
						<img
							src="{asset.url}?w=160&h=160&fit=max&auto=format"
							alt={asset.name}
							title={asset.name}
							loading="lazy"
							draggable="true"
							ondragstart={(event) => onDragStart(event, asset)}
						/>
					</li>
				{/each}
			</ul>
		</details>
	{:else}
		<p>No images. Upload them in Media.</p>
	{/each}
</div>

<style>
	.assets {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		height: 100%;
		padding: 3rem 0.75rem 0.75rem;
		overflow: auto;
		box-sizing: border-box;
	}

	input {
		padding: 0.25rem 0.5rem;
		border: 1px solid #000;
		background: #fff;
		font: inherit;
		cursor: text;
	}

	summary {
		cursor: pointer;
	}

	summary span {
		opacity: 0.5;
	}

	ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		gap: 0.5rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: #efefef;
		cursor: grab;
	}

	p {
		margin: 0;
	}
</style>
