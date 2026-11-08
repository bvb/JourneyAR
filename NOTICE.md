# Notice

The source code of Journey AR is licensed under the [MIT License](LICENSE).

The MIT License does not cover the Journey content that this project uses. All rights to it
belong to its rights holders, and it is used with their permission. This content is:

- _Journey_, the game: its characters, art, 3D models and music;
- _The Art of Journey_, the art book: its pages;
- _Journey AR Viewer_ (DAQRI, 2012), the original AR app: its 3D scenes, textures, sounds and
  target data.

These files contain that content or are made from it:

| Path                           | Contents                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `original-sources/`            | The original app (APK), page scans, icons, background picture             |
| `pages-for-nft/`               | Page images                                                               |
| `journey-ar/assets/`           | 3D models, music and sounds, NFT markers, icons, background picture, logo |
| `journey-ar/tests/recordings/` | Virtual camera recordings of the pages                                    |
| `tools/unity-reference/`       | Renders of the original scenes                                            |

Do not reuse these files outside this project without the permission of the rights holders.

## Third-party software

The app bundles [three.js](https://threejs.org/) (MIT License) and
[jsartoolkit-nft](https://github.com/webarkit/jsartoolkitNFT) (GNU LGPL 3.0). Every production
build carries their license texts in `licenses.txt`, next to `index.html`. The development tools
and their licenses are listed in `package-lock.json`.
