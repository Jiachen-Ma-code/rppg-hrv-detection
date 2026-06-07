// Minimal self-contained canvas line plotter (no charting library dependency).

export class LinePlot {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(data, opts = {}) {
    const color = opts.color ?? '#37d6c4';
    const markers = opts.markers ?? null;
    const { c, ctx } = this;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!data || data.length < 2) return;

    let lo = opts.min ?? Infinity;
    let hi = opts.max ?? -Infinity;
    if (opts.min == null || opts.max == null) {
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (hi - lo < 1e-9) hi = lo + 1;

    const pad = 4;
    const sx = (W - 2 * pad) / (data.length - 1);
    const sy = (H - 2 * pad) / (hi - lo);
    const xOf = (i) => pad + i * sx;
    const yOf = (v) => H - pad - (v - lo) * sy;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, H / 2);
    ctx.lineTo(W - pad, H / 2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = xOf(i);
      const y = yOf(data[i]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();

    if (markers) {
      ctx.fillStyle = '#ff5d6c';
      for (const m of markers) {
        if (m >= 0 && m < data.length) {
          ctx.beginPath();
          ctx.arc(xOf(m), yOf(data[m]), 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}
