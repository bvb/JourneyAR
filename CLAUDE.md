# Journey AR

Браузерное AR-приложение для артбука Journey: при наведении камеры на страницу (Natural Feature Tracking) показывает анимированную 3D-сцену и играет звук. Работает в браузере на Android, iPhone и PC. Ремейк Unity + Vuforia приложения DAQRI 2012 года.

**План и принятые решения — [.plans/plan.md](.plans/plan.md)** (источник истины; там же соответствие страниц, сцен и звуков).

## Структура

- `journey-ar/` — основное приложение (Vite + TS + three.js). `assets/` — publicDir Vite: `models/*.glb`, `audio/*.mp3`, `nft/<scene>/`, `scenes.json`.
- `journey-virtual-book-camera/` — виртуальная камера для тестов (страницы в 3D, выдача потока в приложение).
- `tools/` — конвейер ассетов (Unity-экспорт, NFT, gltf-transform, ffmpeg). Пути к внешним программам — в `tools/config.mjs`, переопределяются переменными окружения.
- `book-ar-pages/` — изображения отслеживаемых страниц (в git, через LFS).
- Вне git: `book/`, `unity-data-project/`, `android-ar-viewer.1.0/`.

## Команды (из корня)

- `npm run dev` — приложение на https://localhost:5173 (самоподписанный сертификат, доступно в LAN).
- `npm run dev:vcam` — виртуальная камера на https://localhost:5174.
- `npm run check` — typecheck + lint + prettier + unit-тесты.
- `npm run e2e` — Playwright: Edge и изолированный Chromium. Один браузер: `npm run e2e -- --project=edge`.
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
- `npm run nft:probe -- --markers=<папка> [id...]` — проверка маркеров без браузера: синтетические кадры с известной позой → Node-сборка jsartoolkit-nft → ошибка позы и время детекта.
- Конвейер целиком: `unity:fix` → `unity:check` → `unity:render` → `unity:export` → `gltf:inspect` → `scenes:compare` → `assets:publish` (Unity закрыт).

## Правила

- Перед коммитом: `npm run check` и `npm run e2e` зелёные.
- Ассеты в `journey-ar/assets` не правятся вручную — только скриптами из `tools/` (`assets:publish`); в `scenes.json` вручную/через debug-режим подстраиваются только `anchor`. Схема `scenes.json` — `journey-ar/src/scenes/manifest.ts`.
- Система страницы — мм, начало в центре страницы, X вправо, Y к верху страницы, Z из страницы. Сцены в GLB — в системе таргета (ширина таргета = 1); перевод — `anchorMatrix()`.
- page166 (daqri) пока не используется, оптимизация GLB отложена до готового приложения (см. решения в плане).
- `unity-data-project` (Unity 6.6, 6000.6.8f1) вне git: все правки в нём вносятся только через `tools/unity/apply-fixes.mjs` (удаления, оверлей `tools/unity/overlay/`, манифест), чтобы их можно было повторить на чистой копии оригинала. Код экспортёра живёт в `tools/unity-export` (локальный UPM-пакет, `.meta`-файлы коммитятся).
- Fixed-function шейдеры оригинала работают в Unity 6 — не переписывать их: эмуляция Unity — эталон оригинального вида.
- AR-контент рендерится в gamma-режиме Unity: перед первым кадром `configureLegacyRendering(renderer, camera)`, текстуры сцен — `NoColorSpace`, цвета из Unity — как есть (`new Color(r, g, b)`), без `SRGBColorSpace`.
- Материалы сцен строятся только в `src/scenes/unity-materials.ts` по `extras.unityShader`. Любое изменение материалов, экспортёра или рендера проверять `npm run scenes:compare` (пороги: средняя разница < 4/255, < 1 % пикселей > 32).
- Эталоны Unity рендерятся без HDR намеренно (как 8-битный буфер телефона).
- Отладка в `scene-preview.html`: `?t=` (время), `?hide=<материалы>`, `?ref=<папка эталонов в tools/.out>`; в Unity — `-journeyTargets`, `-journeyHide`, `-journeyTime`, `-journeyOut` (аргументы `node tools/unity/run-unity.mjs`).
- Unity batchmode не запускается, пока проект открыт в редакторе: попросить пользователя закрыть Unity.
- Тестовые источники кадров (`?source=canvas|webrtc|video`) работают только в dev/test-сборке (`import.meta.env.DEV`).
- TypeScript закреплён на 6.0.x: typescript-eslint пока поддерживает только `<6.1`.
- three.js закреплён на точной версии (0.187.0) вместе с `@types/three`.
- `mind-ar` не устанавливать через npm: он тянет нативный `canvas` 2.x, который не собирается под Node 26. `.mind` компилировать в браузере (фаза 2).
- npm 11 блокирует install-скрипты; разрешённые перечислены в `allowScripts` корневого `package.json`.

## Тестирование на телефоне (Android)

ПК и телефон в одной сети: открыть `https://<IP-ПК>:5173`, один раз принять предупреждение о сертификате. Брандмауэр Windows должен разрешать входящие подключения для Node.js.

## Язык

Пользователь пишет по-русски; документация и план — на русском, код и комментарии в коде — на английском.
