export type PinchPoint = { x: number; y: number };
export type PinchViewport = { x: number; y: number; zoom: number };
export function pinchViewport(start: PinchViewport, first: [PinchPoint, PinchPoint], current: [PinchPoint, PinchPoint], min = .18, max = 2): PinchViewport {
  const distance = (points: [PinchPoint, PinchPoint]) => Math.hypot(points[1].x-points[0].x, points[1].y-points[0].y);
  const midpoint = (points: [PinchPoint, PinchPoint]) => ({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
  const origin=midpoint(first), center=midpoint(current);
  const zoom=Math.min(max,Math.max(min,start.zoom*distance(current)/Math.max(1,distance(first))));
  return {zoom,x:center.x-(origin.x-start.x)*zoom/start.zoom,y:center.y-(origin.y-start.y)*zoom/start.zoom};
}
