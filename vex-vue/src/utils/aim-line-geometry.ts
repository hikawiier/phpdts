/**
 * @module K 状态管理层
 */

export interface AimLineGeometry {
  pathData: string;
  arrowAngle: number;
  lineEndX: number;
  lineEndY: number;
}

export function buildAimLineGeometry(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): AimLineGeometry {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) {
    return {
      pathData: `M ${startX} ${startY} L ${endX} ${endY}`,
      arrowAngle: 0,
      lineEndX: endX,
      lineEndY: endY,
    };
  }

  let normalX = -dy / distance;
  let normalY = dx / distance;
  if (normalY > 0) {
    normalX *= -1;
    normalY *= -1;
  }
  const directionX = dx / distance;
  const directionY = dy / distance;
  const bend = Math.min(46, Math.max(12, distance * 0.1));
  const control1X = startX + directionX * distance * 0.22 + normalX * bend;
  const control1Y = startY + directionY * distance * 0.22 + normalY * bend;
  const control2X = startX + directionX * distance * 0.72 + normalX * bend * 0.25;
  const control2Y = startY + directionY * distance * 0.72 + normalY * bend * 0.25;
  const tangentX = endX - control2X;
  const tangentY = endY - control2Y;
  const tangentLength = Math.hypot(tangentX, tangentY);
  const arrowDirectionX = tangentX / tangentLength;
  const arrowDirectionY = tangentY / tangentLength;
  const trimDistance = Math.min(23, distance * 0.3);
  const lineEndX = endX - arrowDirectionX * trimDistance;
  const lineEndY = endY - arrowDirectionY * trimDistance;
  const lineControl2X = control2X - arrowDirectionX * trimDistance;
  const lineControl2Y = control2Y - arrowDirectionY * trimDistance;
  const arrowAngle = Math.atan2(tangentY, tangentX) * 180 / Math.PI;

  return {
    pathData: `M ${startX} ${startY} C ${control1X} ${control1Y}, ${lineControl2X} ${lineControl2Y} ${lineEndX} ${lineEndY}`,
    arrowAngle,
    lineEndX,
    lineEndY,
  };
}
