# Journey AR

Браузерное AR-приложение для артбука Journey: при наведении камеры на страницу (Natural Feature Tracking) показывает анимированную 3D-сцену и играет звук. Работает в браузере на Android, iPhone и PC. Ремейк Unity + Vuforia приложения DAQRI 2012 года.

**План и принятые решения — [.plans/plan.md](.plans/plan.md)** (источник истины; там же соответствие страниц, сцен и звуков).

## Структура

- `journey-ar/` — основное приложение (Vite + TS + three.js). `assets/` — publicDir Vite: `models/*.glb`, `audio/*.mp3`, `nft/<scene>/`, `scenes.json`.
- `journey-virtual-book-camera/` — виртуальная камера для тестов (страницы в 3D, выдача потока в приложение).
- `tools/` — конвейер ассетов (Unity-экспорт, NFT, gltf-transform, ffmpeg). Пути к внешним программам — в `tools/config.mjs`, переопределяются переменными окружения.
- `book-ar-pages/` — изображения отслеживаемых страниц (в git, через LFS).
- Вне git: `book/`, `unity-data-project/`, `android-ar-viewer.1.0/`, `videos-from-internet/` (видео работы оригинального приложения — эталон вида сцен).

## Команды (из корня)

- `npm run dev` — приложение на https://localhost:5173 (самоподписанный сертификат, доступно в LAN).
- `npm run dev:vcam` — виртуальная камера на https://localhost:5174 (блоки «Запись» и «WebRTC»): страницы клавишами 1–5 (0 — без страницы), поза камеры полями, пресетами и мышью; API `window.__vcam` (`setPage`, `setPose`, `setFrame`, `getGroundTruth`, `project`, `setPaused`/`renderFrame`).
- `npm run check` — typecheck + lint + prettier + unit-тесты.
- `npm run e2e` — Playwright для journey-ar и виртуальной камеры: Edge и изолированный Chromium. Один браузер: `npm run e2e -- --project=edge`.
- `npm run build` — сборка всех workspaces.
- `npm run check-env` — проверка Unity, Blender, ffmpeg и исходных папок.
- `npm run unity:fix` — применить правки к `unity-data-project` (идемпотентно, резервные копии в `tools/.out/unity-backup/`).
- `npm run unity:check` — batchmode-проверка Unity-проекта: компиляция, шейдеры, материалы (отчёт в `tools/.out/unity/`).
- `npm run unity:render` — эталонные рендеры каждого таргета в `tools/.out/reference/`.
- `npm run unity:export` — экспорт каждого таргета в GLB (`tools/.out/export/`) с отчётом `export-report.json`.
- `npm run gltf:inspect` — gltf-validator + сверка GLB с отчётом Unity.
- `npm run scenes:compare` — рендер каждой сцены в three.js (Edge) рядом с эталоном Unity → `tools/.out/compare/<id>.png`. Вручную: `https://localhost:5173/scene-preview.html?scene=<id>&t=<сек>` (только dev-сервер).
- `npm run assets:publish` — GLB и MP3 в `journey-ar/assets`, генерация `scenes.json`; привязка сцен к страницам — поиском текстур таргетов Vuforia на сканах (превью в `tools/.out/anchors/`). Уже записанные привязки сохраняются, пересчёт: `npm run assets:publish -- --reset-anchors`.
- `npm run pages:normalize` — сканы страниц → `book-ar-pages/normalized/<id>.jpg` (1700×1268, 142.5 dpi, симметричная обрезка).
- `npm run nft:generate -- [id...]` — NFT-маркеры (`.iset/.fset/.fset3`) в `journey-ar/assets/nft/<id>/` (`--pages=`, `--out=` для экспериментов); логи в `tools/.out/logs/`.
- `npm run nft:probe -- [id...] [--together] [--markers=<папка>]` — проверка маркеров без браузера: синтетические кадры с известной позой → Node-сборка jsartoolkit-nft → ошибка позы, время детекта, путаница страниц (`--together` — все маркеры в одном трекере, как в приложении). По умолчанию — маркеры приложения; относительная `--markers` считается от `tools/`.
- После смены страниц: `pages:normalize` → `nft:generate` → `assets:publish` → `nft:probe -- --together`.
- Конвейер целиком: `unity:fix` → `unity:check` → `unity:render` → `unity:export` → `gltf:inspect` → `scenes:compare` → `assets:publish` (Unity закрыт).

## Правила

- Перед коммитом: `npm run check` и `npm run e2e` зелёные.
- Ассеты в `journey-ar/assets` не правятся вручную — только скриптами из `tools/` (`assets:publish`); в `scenes.json` вручную/через debug-режим подстраиваются только `anchor`. Схема `scenes.json` — `journey-ar/src/scenes/manifest.ts`.
- Система страницы — мм, начало в центре страницы, X вправо, Y к верху страницы, Z из страницы. Поза трекера (`origin: 'center'`) и точная поза vcam — матрица страница → камера в осях OpenGL, мм. Сцены в GLB — в системе таргета (ширина таргета = 1); перевод — `anchorMatrix()`.
- page166 (daqri) пока не используется, оптимизация GLB отложена до готового приложения (см. решения в плане).
- `unity-data-project` (Unity 6.6, 6000.6.8f1) вне git: все правки в нём вносятся только через `tools/unity/apply-fixes.mjs` (удаления, оверлей `tools/unity/overlay/` поверх существующих файлов, новые файлы `tools/unity/additions/` с фиксированными GUID, возврат потерянных шейдеров материалам, манифест), чтобы их можно было повторить на чистой копии оригинала. Проект извлечён из пересборки 2017 года; оригинальная сборка 2012 года — `android-ar-viewer.1.0/assets/bin/Data` (Unity 3.5.5f3), её можно читать UnityPy (`python -m venv tools/.out/pyenv`, `pip install UnityPy`), когда нужно выяснить, каким был объект в оригинале. Код экспортёра живёт в `tools/unity-export` (локальный UPM-пакет, `.meta`-файлы коммитятся).
- Fixed-function шейдеры оригинала работают в Unity 6 — не переписывать их: эмуляция Unity — эталон оригинального вида.
- AR-контент рендерится в gamma-режиме Unity: перед первым кадром `configureLegacyRendering(renderer, camera)`, текстуры сцен — `NoColorSpace`, цвета из Unity — как есть (`new Color(r, g, b)`), без `SRGBColorSpace`.
- Материалы сцен строятся только в `src/scenes/unity-materials.ts` по `extras.unityShader`. Любое изменение материалов, экспортёра или рендера проверять `npm run scenes:compare` (пороги: средняя разница < 4/255, < 1 % пикселей > 32).
- Эталоны Unity рендерятся без HDR намеренно (как 8-битный буфер телефона).
- Отладка в `scene-preview.html`: `?t=` (время), `?hide=<материалы>`, `?ref=<папка эталонов в tools/.out>`; в Unity — `-journeyTargets`, `-journeyHide`, `-journeyTime`, `-journeyOut` (относительно корня репозитория), `-journeyFocus=<объект>` (крупный план объекта) — аргументы `node tools/unity/run-unity.mjs`. Пример крупного плана: `node tools/unity/run-unity.mjs Journey.UnityExport.ReferenceRenderer.RenderAll -journeyTargets creature -journeyFocus polySurface374 -journeyTime 3 -journeyOut tools/.out/reference-creature-head`, затем `scene-preview.html?scene=creature&t=3&ref=reference-creature-head`.
- Unity batchmode не запускается, пока проект открыт в редакторе: попросить пользователя закрыть Unity.
- Трекинг: `src/tracking/` — jsartoolkit-nft в воркере (файлы воркера раздаются по `/nft-worker/` плагином в `vite.config.ts`), кадр 640 px по длинной стороне, одна активная страница, потеря на первом кадре без страницы, фильтр `native`. Портретное видео подаётся трекеру повёрнутым в альбомный кадр (`rotated` в геометрии), поэтому поворот телефона не пересоздаёт трекер. Показываемая поза сглаживается (`src/tracking/pose-smoother.ts`: One Euro + плавное догоняние на каждом кадре экрана). Параметры отладки: `?fov=<угол по длинной стороне>` (по умолчанию 63°), `?filter=native|none|oneeuro` (фильтр ядра трекера), `?smooth=off` или `?smooth=<minCutoff>,<beta>,<rotationBeta>,<easing>`, `?debug` (контур страницы и оси).
- Сцены: `src/scenes/ar-scenes.ts` — якорь (поза трекера) → `anchorMatrix(scene.anchor)` → GLB; ленивая загрузка, предзагрузка в фоне после старта трекера, перезапуск анимаций при каждом обнаружении, скрытие в кадр потери. Щипок (`src/interaction/`) масштабирует узел `scenes.json` → `pinch.node` в пределах оригинала, сбрасывается при каждом обнаружении.
- Звук: `src/audio/scene-audio.ts` — Web Audio, AudioContext открывается кнопкой «Старт» (синхронно в клике); трек с начала при обнаружении, затухание при потере, бесшовная петля (`loopBounds`), объёмный: `PannerNode` над центром сцены, позиция по сглаженной позе, модель затухания `SPATIAL` в `src/audio/loop-bounds.ts`. Состояние — `window.__journey.audio` (геттер с уровнями до/после панорамы).
- Выбор страницы: `src/tracking/page-selector.ts` — одна активная страница; при высокой ошибке трекинга (> 1.2) трекер временно ищет другие страницы, чтобы не держать неверную. Состояние — `window.__journey.scenes`. Состояние трекера — `window.__journey.tracking` (страница, поза, события found/lost); метрики по точной позе — `tests/e2e/tracking.spec.ts`.
- Тестовые источники кадров (`?source=canvas|webrtc|video`) работают только в dev/test-сборке (`import.meta.env.DEV`), запускаются кнопкой «Старт»:
  - `canvas` — виртуальная камера внутри приложения, управление через `window.__vcam`;
  - `webrtc` — поток из открытой vcam (`npm run dev:vcam`) через ретранслятор `/__signal` dev-сервера приложения (работает и на телефоне в LAN); `?room=<имя>` у обоих разводит несколько пар (тесты);
  - `video&src=/__recordings/<имя>.webm` — запись из `journey-ar/tests/recordings` (записи делает vcam: кнопка «Запись» или `__vcam.startRecording()`/`stopRecording(имя)`, рядом `<имя>.json` с точной позой каждого кадра).
- TypeScript закреплён на 6.0.x: typescript-eslint пока поддерживает только `<6.1`.
- three.js закреплён на точной версии (0.187.0) вместе с `@types/three`.
- `mind-ar` не устанавливать через npm: он тянет нативный `canvas` 2.x, который не собирается под Node 26. `.mind` компилировать в браузере (фаза 2).
- npm 11 блокирует install-скрипты; разрешённые перечислены в `allowScripts` корневого `package.json`.

## Тестирование на телефоне (Android)

ПК и телефон в одной сети: открыть `https://<IP-ПК>:5173`, один раз принять предупреждение о сертификате. Брандмауэр Windows должен разрешать входящие подключения для Node.js.

## Язык

Пользователь пишет по-русски; документация и план — на русском, код и комментарии в коде — на английском.
