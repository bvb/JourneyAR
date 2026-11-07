import { Mesh, NoColorSpace, PlaneGeometry, ShaderMaterial, Vector2, VideoTexture } from 'three';

/**
 * The camera picture drawn into the WebGL canvas, behind the AR content, cropped like
 * `object-fit: cover` (centred, as the tracker's projection is fitted). The original drew the
 * video into the frame buffer too (Vuforia), and the scenes' blending relies on it: additive
 * light adds to the picture. Over a transparent canvas the light would instead be composited by
 * the alpha the blending leaves behind and darken the video.
 */
export class VideoBackground {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  /** The camera picture, uploaded once per video frame (the tracker's frames are made from it). */
  readonly texture: VideoTexture;
  private readonly scale = new Vector2(1, 1);

  constructor(private readonly video: HTMLVideoElement) {
    this.texture = new VideoTexture(video);
    // Shown as stored, like the rest of the gamma-workflow rendering.
    this.texture.colorSpace = NoColorSpace;
    const material = new ShaderMaterial({
      name: 'VideoBackground',
      uniforms: { map: { value: this.texture }, scale: { value: this.scale } },
      vertexShader: /* glsl */ `
        uniform vec2 scale;
        varying vec2 vUv;
        void main() {
          vUv = (uv - 0.5) * scale + 0.5;
          // The whole view, at the far plane.
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), material);
    this.mesh.name = 'video-background';
    this.mesh.frustumCulled = false;
    // Drawn first: opaque objects are sorted by render order before anything else.
    this.mesh.renderOrder = -1e9;
    this.mesh.visible = false;
  }

  /** Fits the picture to a view of the given size; hidden while there is no video. */
  update(viewWidth: number, viewHeight: number, active: boolean): void {
    const { videoWidth, videoHeight } = this.video;
    const visible = active && videoWidth > 0 && videoHeight > 0 && viewWidth > 0;
    this.mesh.visible = visible;
    if (!visible) return;
    const viewAspect = viewWidth / viewHeight;
    const videoAspect = videoWidth / videoHeight;
    // Cover: the video fills the view, the overhanging side is cropped evenly.
    if (videoAspect > viewAspect) this.scale.set(viewAspect / videoAspect, 1);
    else this.scale.set(1, videoAspect / viewAspect);
  }
}
