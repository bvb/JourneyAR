/** Stops the tracks of a stream shown in `video` and detaches it. */
export function releaseStream(video: HTMLVideoElement | null): void {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) for (const track of stream.getTracks()) track.stop();
  if (video) video.srcObject = null;
}
