import { useEffect, useRef } from 'react';
import { mount, unmount } from 'svelte';
import { ImageIcon } from '@sanity/icons/Image';
import { useClient, useDocumentOperation, useEditState, type Tool } from 'sanity';
import Canvas from './Canvas.svelte';
import type { Asset, Bridge } from './types';

const ID = 'canvas';
const TYPE = 'canvas';
const INITIAL = { _id: ID, _type: TYPE, width: 1500, height: 1500, items: [] };
const ASSETS = `*[_type == "sanity.imageAsset"] | order(coalesce(title, originalFilename) asc) {
	_id, url,
	"name": coalesce(title, originalFilename, _id),
	"folder": opt.media.folder->name,
	"width": metadata.dimensions.width,
	"height": metadata.dimensions.height
}`;

function CanvasTool() {
	const target = useRef<HTMLDivElement>(null);
	const app = useRef<ReturnType<typeof mount>>(null);
	const client = useClient({ apiVersion: '2026-11-01' });
	const ops = useDocumentOperation(ID, TYPE);
	const edit = useEditState(ID, TYPE);
	const latestOps = useRef(ops);
	latestOps.current = ops;

	useEffect(() => {
		const bridge: Bridge = {
			listAssets: () => client.fetch<Asset[]>(ASSETS),
			patch: (patches) => latestOps.current.patch.execute(patches, INITIAL),
			publish: () => latestOps.current.publish.execute()
		};
		const instance = mount(Canvas, { target: target.current!, props: { bridge } });
		app.current = instance;
		return () => void unmount(instance);
	}, [client]);

	useEffect(() => {
		if (edit.ready) app.current?.update(edit.draft ?? edit.published ?? INITIAL, !ops.publish.disabled);
	}, [edit, ops.publish.disabled]);

	return <div ref={target} style={{ height: '100%' }} />;
}

export const canvasTool: Tool = { name: 'canvas', title: 'Canvas', icon: ImageIcon, component: CanvasTool };
