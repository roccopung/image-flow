import { useEffect, useRef, useState } from 'react';
import { mount, unmount } from 'svelte';
import { ImageIcon } from '@sanity/icons/Image';
import { useClient, useDocumentOperation, useEditState, type Tool } from 'sanity';
import Canvas from './Canvas.svelte';
import type { Asset, Bridge, Status } from './types';

const TYPE = 'canvas';
const initial = (id: string) => ({ _id: id, _type: TYPE, width: 1500, height: 1500, items: [] });
const ASSETS = `*[_type == "sanity.imageAsset"] | order(coalesce(title, originalFilename) asc) {
	_id, url,
	"name": coalesce(title, originalFilename, _id),
	"folder": opt.media.folder->name,
	"width": metadata.dimensions.width,
	"height": metadata.dimensions.height
}`;
const CANVASES = `*[_type == "canvas"] | order(title asc) {_id, title}`;
const LIVE = `*[_id == "settings"][0].canvas._ref`;

function CanvasTool() {
	const target = useRef<HTMLDivElement>(null);
	const app = useRef<ReturnType<typeof mount>>(null);
	const client = useClient({ apiVersion: '2026-11-01' });
	const [id, setId] = useState('canvas');
	const [liveId, setLiveId] = useState<string>();
	const [canvases, setCanvases] = useState<Status['canvases']>([]);
	const ops = useDocumentOperation(id, TYPE);
	const edit = useEditState(id, TYPE);
	const latest = useRef({ id, ops });
	latest.current = { id, ops };

	const loadCanvases = () => client.fetch(CANVASES, {}, { perspective: 'drafts' }).then(setCanvases);

	useEffect(() => {
		loadCanvases();
		client.fetch<string | null>(LIVE).then((live) => setLiveId(live ?? undefined));
	}, [client]);

	useEffect(() => {
		const bridge: Bridge = {
			listAssets: () => client.fetch<Asset[]>(ASSETS),
			select: setId,
			create: (title) => {
				const doc = { ...initial(crypto.randomUUID()), title };
				client
					.create({ ...doc, _id: `drafts.${doc._id}` })
					.then(loadCanvases)
					.then(() => setId(doc._id));
			},
			patch: (patches) => latest.current.ops.patch.execute(patches, initial(latest.current.id)),
			publish: () => {
				const { id, ops } = latest.current;
				if (!ops.publish.disabled) ops.publish.execute();
				client
					.createOrReplace({ _id: 'settings', _type: 'settings', canvas: { _type: 'reference', _ref: id, _weak: true } })
					.then(() => setLiveId(id));
			}
		};
		const instance = mount(Canvas, { target: target.current!, props: { bridge } });
		app.current = instance;
		return () => void unmount(instance);
	}, [client]);

	useEffect(() => {
		if (!edit.ready) return;
		const status: Status = { id, canvases, live: id === liveId, publishable: !ops.publish.disabled };
		app.current?.update(edit.draft ?? edit.published ?? initial(id), status);
	}, [edit, ops.publish.disabled, id, liveId, canvases]);

	return <div ref={target} style={{ height: '100%' }} />;
}

export const canvasTool: Tool = { name: 'canvas', title: 'Canvas', icon: ImageIcon, component: CanvasTool };
