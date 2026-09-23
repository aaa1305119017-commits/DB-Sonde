import * as echarts from "echarts";

interface FreeCrosshairOptions {
  horizontalValueAxis: boolean;
  formatValue?: (value: number) => string;
  lineColor: string;
  labelColor: string;
  labelBackground: string;
  labelBorder: string;
}

/** V1-style free crosshair. It is rendered on zrender so the guides follow the
 * raw pointer instead of snapping to category ticks like ECharts axisPointer. */
export function installFreeCrosshair(chart: echarts.ECharts, options: FreeCrosshairOptions): () => void {
  const graphics = (echarts as unknown as { graphic: any }).graphic;
  const zr = chart.getZr();
  if (!graphics?.Group || !graphics?.Line || !graphics?.Text || !zr) return () => undefined;

  const order = { zlevel: 100, z: 100, z2: 100_000 };
  const lineStyle = { stroke: options.lineColor, lineWidth: 1, lineDash: [5, 5], opacity: 0.92 };
  const group = new graphics.Group({ silent: true, invisible: true, ...order });
  const vertical = new graphics.Line({ silent: true, ...order, style: lineStyle });
  const horizontal = new graphics.Line({ silent: true, ...order, style: lineStyle });
  const valueLabel = new graphics.Text({
    silent: true,
    ...order,
    style: {
      fill: options.labelColor,
      backgroundColor: options.labelBackground,
      borderColor: options.labelBorder,
      borderWidth: 1,
      borderRadius: 4,
      padding: [4, 7],
      font: "600 11px Inter, PingFang SC, sans-serif",
      align: "left",
      verticalAlign: "middle",
    },
  });
  group.add(vertical);
  group.add(horizontal);
  group.add(valueLabel);
  zr.add(group);

  let latest: { x: number; y: number } | null = null;
  let frame = 0;
  const hide = () => {
    latest = null;
    group.attr({ invisible: true });
  };
  const paint = () => {
    frame = 0;
    if (!latest || chart.isDisposed()) return;
    const grid = (chart as any).getModel?.().getComponent("grid", 0)?.coordinateSystem?.getRect?.();
    if (!grid) return;
    const { x, y } = latest;
    if (x < grid.x || x > grid.x + grid.width || y < grid.y || y > grid.y + grid.height) {
      hide();
      return;
    }
    const coord = chart.convertFromPixel({ gridIndex: 0 }, [x, y]);
    const value = Number(Array.isArray(coord) ? coord[options.horizontalValueAxis ? 0 : 1] : coord);
    vertical.setShape({ x1: x, y1: grid.y, x2: x, y2: grid.y + grid.height });
    horizontal.setShape({ x1: grid.x, y1: y, x2: grid.x + grid.width, y2: y });
    valueLabel.setStyle({
      text: Number.isFinite(value)
        ? options.formatValue ? options.formatValue(value) : value.toLocaleString("en-US", { maximumFractionDigits: 2, useGrouping: false })
        : "",
      x: options.horizontalValueAxis ? x : grid.x + 2,
      y: options.horizontalValueAxis ? grid.y + grid.height - 2 : y,
      align: options.horizontalValueAxis ? "center" : "left",
      verticalAlign: options.horizontalValueAxis ? "bottom" : "middle",
    });
    group.attr({ invisible: false });
  };
  const move = (event: { offsetX: number; offsetY: number }) => {
    latest = { x: event.offsetX, y: event.offsetY };
    if (!frame) frame = requestAnimationFrame(paint);
  };
  zr.on("mousemove", move);
  zr.on("globalout", hide);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    zr.off("mousemove", move);
    zr.off("globalout", hide);
    zr.remove(group);
  };
}
