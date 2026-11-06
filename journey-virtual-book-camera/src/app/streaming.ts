import { type Recorder, type VirtualCamera, type WebRtcSender, saveRecording } from '../core';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function defaultName(vcam: VirtualCamera): string {
  const time = new Date().toTimeString().slice(0, 8).replaceAll(':', '');
  return `vcam-${vcam.getPage() ?? 'empty'}-${time}`;
}

/** Recording and WebRTC sections of the panel. */
export function buildStreamingPanel(
  root: HTMLElement,
  vcam: VirtualCamera,
  recorder: Recorder,
  sender: WebRtcSender,
  signalUrl: string,
): void {
  const name = element('input', {
    type: 'text',
    ariaLabel: 'Имя записи',
    placeholder: 'имя записи',
  });
  const button = element('button', { type: 'button', textContent: '● Запись' });
  const recordStatus = element('p', { className: 'info' });
  button.addEventListener('click', async () => {
    if (!recorder.recording) {
      name.value ||= defaultName(vcam);
      if (!/^[\w-]+$/.test(name.value)) {
        recordStatus.textContent = 'Имя: латиница, цифры, «-» и «_»';
        return;
      }
      recorder.start();
      button.textContent = '■ Стоп';
      recordStatus.textContent = 'Идёт запись…';
      root.classList.add('recording');
      return;
    }
    button.disabled = true;
    const recording = await recorder.stop();
    root.classList.remove('recording');
    recordStatus.textContent = 'Сохранение…';
    const saved = await saveRecording(name.value, recording);
    recordStatus.textContent = `Сохранено: ${saved.path}, ${saved.seconds.toFixed(1)} с, ${saved.frames} кадров`;
    name.value = '';
    button.textContent = '● Запись';
    button.disabled = false;
  });

  const webrtcStatus = element('p', { className: 'info' });
  const showStatus = () => {
    const { connected, receivers } = sender.status;
    webrtcStatus.textContent = connected
      ? `Ретранслятор подключён, получателей: ${receivers}`
      : `Нет связи с ретранслятором ${signalUrl} (запущен ли npm run dev?)`;
  };
  sender.onStatus(showStatus);
  showStatus();

  root.append(
    element('section', {}, [
      element('h2', { textContent: 'Запись' }),
      element('div', { className: 'row record' }, [name, button]),
      recordStatus,
    ]),
    element('section', {}, [
      element('h2', { textContent: 'WebRTC' }),
      webrtcStatus,
      element('p', {
        className: 'info',
        textContent: 'Приложение: https://<адрес>:5173/?source=webrtc',
      }),
    ]),
  );
}
