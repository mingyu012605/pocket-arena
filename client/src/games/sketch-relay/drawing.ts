import type { SketchDrawing, SketchStroke } from "../../../../shared/protocol";

export const SKETCH_COLORS = ["#111827", "#ef4444", "#f97316", "#eab308", "#22c55e", "#0ea5e9", "#6366f1", "#ec4899"] as const;

export function setupHiDpiCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

export function renderSketchDrawing(canvas: HTMLCanvasElement, drawing: SketchDrawing): void {
  const ctx = setupHiDpiCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.save();
  for (const stroke of drawing.strokes) drawStroke(ctx, stroke, rect.width, rect.height);
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke, width: number, height: number): void {
  if (stroke.points.length === 0) return;
  ctx.globalCompositeOperation = stroke.eraser ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  const first = stroke.points[0]!;
  ctx.moveTo(first.x * width, first.y * height);
  for (let i = 1; i < stroke.points.length; i++) {
    const prev = stroke.points[i - 1]!;
    const current = stroke.points[i]!;
    const midX = ((prev.x + current.x) / 2) * width;
    const midY = ((prev.y + current.y) / 2) * height;
    ctx.quadraticCurveTo(prev.x * width, prev.y * height, midX, midY);
  }
  const last = stroke.points[stroke.points.length - 1]!;
  ctx.lineTo(last.x * width, last.y * height);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

export function drawingIsBlank(drawing: SketchDrawing): boolean {
  return drawing.strokes.every((stroke) => stroke.points.length < 2);
}
