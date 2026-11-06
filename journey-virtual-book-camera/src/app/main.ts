import { Recorder, VirtualCamera, WebRtcSender, createVcamApi, defaultSignalUrl } from '../core';
import { buildPanel } from './panel';
import { buildStreamingPanel } from './streaming';
import './style.css';
import { attachViewControls } from './view-controls';

const canvas = document.querySelector<HTMLCanvasElement>('#frame');
const view = document.querySelector<HTMLElement>('#view');
const panel = document.querySelector<HTMLElement>('#panel');
if (!canvas || !view || !panel) throw new Error('Page layout elements are missing');

const vcam = new VirtualCamera(canvas);
const recorder = new Recorder(vcam);
const api = createVcamApi(vcam, recorder);
window.__vcam = api;

// The frames go to the app over WebRTC through the relay of its dev server (`?signal=` to
// point elsewhere); the app asks for them with `?source=webrtc`.
const signalUrl =
  new URLSearchParams(window.location.search).get('signal') ?? defaultSignalUrl(window.location);
const sender = new WebRtcSender(vcam, signalUrl);

buildPanel(panel, vcam);
buildStreamingPanel(panel, vcam, recorder, sender, signalUrl);
attachViewControls(view, vcam);
sender.start();

await vcam.setPage(vcam.pages[0]?.id ?? null);
vcam.start();
api.ready = true;
