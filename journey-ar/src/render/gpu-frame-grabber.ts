import type { TrackerFrame } from '@webarkit/jsartoolkit-nft/client';
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { FrameGrabber, FrameSize } from '../tracking/frame-grabber';

/**
 * The tracker's frame made on the GPU: the camera picture (the video texture the background
 * already uploads) is drawn scaled, and turned for a portrait video, into a small render target
 * of the processing size, which is read back asynchronously (pixel buffer and fence: the main
 * thread neither reads the whole video frame back nor waits for the GPU). The frame is ready a
 * few milliseconds later, usually by the next display frame.
 */
export class GpuFrameGrabber implements FrameGrabber {
  private target: WebGLRenderTarget | null = null;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor(
    private readonly renderer: WebGLRenderer,
    texture: Texture,
  ) {
    this.material = new ShaderMaterial({
      name: 'TrackerFrame',
      uniforms: {
        map: { value: texture },
        rotated: { value: false },
        texel: { value: new Vector2() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vFrame;
        void main() {
          vFrame = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      // vFrame: frame position, x to the right and y down from the top row (the render target's
      // first row is the first row read back, and the tracker wants the top row first). The
      // texture is flipped (its v goes up). A portrait video is turned clockwise: its top to the
      // frame's right edge (as CanvasFrameGrabber draws it).
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform bool rotated;
        uniform vec2 texel;
        varying vec2 vFrame;
        vec4 sampleAt(vec2 frame) {
          vec2 uv = rotated ? vec2(frame.y, frame.x) : vec2(frame.x, 1.0 - frame.y);
          return texture2D(map, uv);
        }
        void main() {
          // Four taps over the frame pixel: a box filter for the 2-3 times smaller frame.
          vec2 d = 0.25 * texel;
          vec4 color = sampleAt(vFrame + vec2(-d.x, -d.y)) + sampleAt(vFrame + vec2(d.x, -d.y)) +
            sampleAt(vFrame + vec2(-d.x, d.y)) + sampleAt(vFrame + vec2(d.x, d.y));
          gl_FragColor = vec4(color.rgb * 0.25, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  async grab(_video: HTMLVideoElement, size: FrameSize, rotated: boolean): Promise<TrackerFrame> {
    const { width, height } = size;
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(width, height, {
        depthBuffer: false,
        generateMipmaps: false,
      });
    }
    this.material.uniforms['rotated']!.value = rotated;
    (this.material.uniforms['texel']!.value as Vector2).set(1 / width, 1 / height);
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    // A new buffer each frame: the tracker takes it over (transferred to its worker).
    const data = new Uint8Array(width * height * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, width, height, data);
    return { data, width, height };
  }

  dispose(): void {
    this.target?.dispose();
    this.material.dispose();
  }
}
