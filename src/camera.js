// Webcam access via getUserMedia. Requires a secure context (https or
// http://localhost), which is why the app is served over http.server.

export async function startCamera(videoEl, opts = {}) {
  const width = opts.width ?? 640;
  const height = opts.height ?? 480;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia is not available in this context (needs https or localhost).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width, height, facingMode: 'user' },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}
