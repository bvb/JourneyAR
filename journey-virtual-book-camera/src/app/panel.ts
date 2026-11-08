import { type CameraPose, type VirtualCamera, horizontalFov, verticalFov } from '../core';
import { POSE_PRESETS, RESOLUTIONS } from './presets';

const PAGE_LABELS: Record<string, string> = {
  character: 'Character · с. 30',
  creature: 'Creature · с. 57',
  landscape: 'Landscape · с. 69',
  architecture: 'Architecture · с. 103',
  sequence: 'Sequence · с. 146',
  daqri: 'Daqri · в конце книги',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function section(title: string, children: Node[]): HTMLElement {
  return element('section', {}, [element('h2', { textContent: title }), ...children]);
}

interface Row {
  node: HTMLElement;
  refresh(): void;
}

/** A labelled slider with a number field, both bound to one value. */
function numberRow(
  label: string,
  range: { min: number; max: number; step: number },
  get: () => number,
  set: (value: number) => void,
): Row {
  // A label element only labels its first control, so both get an explicit name.
  const slider = element('input', { type: 'range', ...stringify(range), ariaLabel: label });
  const field = element('input', { type: 'number', step: String(range.step), ariaLabel: label });
  const apply = (value: string) => {
    const number = Number(value);
    if (value !== '' && Number.isFinite(number)) set(number);
  };
  slider.addEventListener('input', () => apply(slider.value));
  field.addEventListener('change', () => apply(field.value));
  return {
    node: element('div', { className: 'row' }, [
      element('span', { textContent: label }),
      slider,
      field,
    ]),
    refresh() {
      const value = get();
      slider.value = String(value);
      // Do not overwrite what the user is typing.
      if (document.activeElement !== field) field.value = String(Math.round(value * 10) / 10);
    },
  };
}

function stringify(range: { min: number; max: number; step: number }) {
  return { min: String(range.min), max: String(range.max), step: String(range.step) };
}

/** Builds the control panel and keeps it in sync with the camera. */
export function buildPanel(root: HTMLElement, vcam: VirtualCamera): void {
  const pageButtons = new Map<string | null, HTMLButtonElement>();
  const pageList = element('div', { className: 'buttons' });
  const pageEntries: [string | null, string, string][] = [
    ...vcam.pages.map((p, i): [string, string, string] => [
      p.id,
      String(i + 1),
      PAGE_LABELS[p.id] ?? p.id,
    ]),
    [null, '0', 'Без страницы'],
  ];
  for (const [id, key, label] of pageEntries) {
    const button = element('button', { type: 'button', title: `Клавиша ${key}` }, [
      element('kbd', { textContent: key }),
      ` ${label}`,
    ]);
    button.addEventListener('click', () => void vcam.setPage(id));
    pageButtons.set(id, button);
    pageList.append(button);
  }

  const pose = (key: keyof CameraPose) => vcam.getPose()[key] as number;
  const rows: Row[] = [
    numberRow(
      'Цель X, мм',
      { min: -400, max: 400, step: 1 },
      () => vcam.getPose().target[0],
      (x) => vcam.setPose({ target: [x, vcam.getPose().target[1]] }),
    ),
    numberRow(
      'Цель Y, мм',
      { min: -300, max: 300, step: 1 },
      () => vcam.getPose().target[1],
      (y) => vcam.setPose({ target: [vcam.getPose().target[0], y] }),
    ),
    numberRow(
      'Расстояние, мм',
      { min: 50, max: 1500, step: 1 },
      () => pose('distance'),
      (distance) => vcam.setPose({ distance }),
    ),
    numberRow(
      'Наклон, °',
      { min: 0, max: 85, step: 0.5 },
      () => pose('tilt'),
      (tilt) => vcam.setPose({ tilt }),
    ),
    numberRow(
      'Азимут, °',
      { min: -180, max: 180, step: 0.5 },
      () => pose('azimuth'),
      (azimuth) => vcam.setPose({ azimuth }),
    ),
    numberRow(
      'Крен, °',
      { min: -180, max: 180, step: 0.5 },
      () => pose('roll'),
      (roll) => vcam.setPose({ roll }),
    ),
  ];

  const presets = element('div', { className: 'buttons' });
  for (const preset of POSE_PRESETS) {
    const button = element('button', { type: 'button', textContent: preset.label });
    button.addEventListener('click', () => vcam.setPose(preset.pose));
    presets.append(button);
  }

  const resolution = element('select');
  for (const { width, height } of RESOLUTIONS) {
    resolution.append(
      element('option', { value: `${width}x${height}`, textContent: `${width} × ${height}` }),
    );
  }
  resolution.addEventListener('change', () => {
    const [width, height] = resolution.value.split('x').map(Number);
    vcam.setFrame({ width, height });
  });
  const fovRow = numberRow(
    'Обзор по длинной стороне, °',
    { min: 20, max: 120, step: 0.5 },
    () => vcam.getFrame().fov,
    (fov) => vcam.setFrame({ fov }),
  );
  const frameInfo = element('p', { className: 'info' });
  const truthInfo = element('pre', { className: 'info' });

  root.append(
    element('h1', { textContent: 'Виртуальная камера' }),
    section('Страница', [pageList]),
    section('Камера', [...rows.map((r) => r.node), presets]),
    section('Кадр', [
      element('label', { className: 'row' }, [
        element('span', { textContent: 'Разрешение' }),
        resolution,
      ]),
      fovRow.node,
      frameInfo,
    ]),
    section('Точная поза', [truthInfo]),
    element('p', {
      className: 'hint',
      textContent:
        'Мышь над кадром: перетаскивание — наклон и азимут, Shift или правая кнопка — сдвиг, колесо — расстояние.',
    }),
  );

  const refresh = () => {
    for (const [id, button] of pageButtons)
      button.classList.toggle('active', id === vcam.getPage());
    for (const row of [...rows, fovRow]) row.refresh();
    const frame = vcam.getFrame();
    resolution.value = `${frame.width}x${frame.height}`;
    const truth = vcam.groundTruth();
    frameInfo.textContent = `По горизонтали ${horizontalFov(frame).toFixed(1)}°, по вертикали ${verticalFov(frame).toFixed(1)}°, фокус ${truth.focal.toFixed(1)} px`;
    const m = truth.modelView;
    const distance = Math.hypot(m[12]!, m[13]!, m[14]!);
    truthInfo.textContent =
      `страница: ${truth.page ?? '—'}, в кадре ${(truth.pageInView * 100).toFixed(0)} %\n` +
      `до центра страницы ${distance.toFixed(1)} мм\n` +
      [0, 1, 2]
        .map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]!.toFixed(3).padStart(9)).join(' '))
        .join('\n');
  };
  vcam.onChange(refresh);
  refresh();

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
      return;
    const entry = pageEntries.find(([, key]) => key === event.key);
    if (entry) void vcam.setPage(entry[0]);
  });
}
