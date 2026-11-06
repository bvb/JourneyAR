import { VirtualCamera, createVcamApi } from '../core';
import { buildPanel } from './panel';
import './style.css';
import { attachViewControls } from './view-controls';

const canvas = document.querySelector<HTMLCanvasElement>('#frame');
const view = document.querySelector<HTMLElement>('#view');
const panel = document.querySelector<HTMLElement>('#panel');
if (!canvas || !view || !panel) throw new Error('Page layout elements are missing');

const vcam = new VirtualCamera(canvas);
const api = createVcamApi(vcam);
window.__vcam = api;

buildPanel(panel, vcam);
attachViewControls(view, vcam);

await vcam.setPage(vcam.pages[0]?.id ?? null);
vcam.start();
api.ready = true;
