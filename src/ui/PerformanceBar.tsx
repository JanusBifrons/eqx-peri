import React from 'react';
import { Box, styled } from '@mui/material';
import { GameEngine } from '../game/core/GameEngine';
import { useGameStore } from '../stores/gameStore';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Pixel height of the bar — imported by App.tsx to push other top UI below it. */
export const PERF_BAR_HEIGHT = 28;

// ── Styled components ─────────────────────────────────────────────────────────

// Full-width bar pinned to the very top of the screen.
const Bar = styled(Box)({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: PERF_BAR_HEIGHT,
  background: 'rgba(0, 0, 0, 0.85)',
  borderBottom: '1px solid #2a2a2a',
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 12,
  paddingRight: 12,
  gap: 0,
  fontFamily: 'monospace',
  fontSize: 13,
  color: '#ffffff',
  zIndex: 1050,
  pointerEvents: 'none',
  userSelect: 'none',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

const Divider = styled('span')({
  color: '#333',
  margin: '0 10px',
  flexShrink: 0,
});

const MetricWrap = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  flexShrink: 0,
});

const MetricLabel = styled('span')({
  color: '#666',
});

// Value with a fixed min-width so digit-count changes don't reflow neighbours.
// min-width is set per-instance via sx prop.
const MetricValue = styled('span')({
  display: 'inline-block',
  textAlign: 'right',
  color: '#ffffff',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Colour-code FPS: green ≥ 55, amber ≥ 30, red below. */
function fpsColor(fps: number): string {
  if (fps >= 55) return '#00e676';
  if (fps >= 30) return '#ffca28';
  return '#ef5350';
}

/** Colour-code tick time: green ≤ 4 ms, amber ≤ 10 ms, red above. */
function tickColor(ms: number): string {
  if (ms <= 4) return '#00e676';
  if (ms <= 10) return '#ffca28';
  return '#ef5350';
}

interface MetricProps {
  label: string;
  value: string;
  /** Reserved pixel width for the value field — prevents layout jumps as digits change. */
  valueWidth: number;
  color?: string;
}

const Metric: React.FC<MetricProps> = ({ label, value, valueWidth, color }) => (
  <MetricWrap>
    <MetricLabel>{label}:</MetricLabel>
    <MetricValue sx={{ minWidth: valueWidth, color: color ?? '#ffffff' }}>{value}</MetricValue>
  </MetricWrap>
);

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  gameEngine: GameEngine | null;
  visible: boolean;
}

const PerformanceBar: React.FC<Props> = ({ gameEngine: _gameEngine, visible }) => {
  const metrics = useGameStore(s => s.performanceMetrics);

  if (!visible) return null;

  return (
    <Bar>
      {/* 3 digits max → ~27px at 13px monospace */}
      <Metric label="FPS"     value={String(metrics.fps)}               valueWidth={27} color={fpsColor(metrics.fps)} />
      <Divider>|</Divider>
      {/* "99.9 ms" → 7 chars → ~63px */}
      <Metric label="TICK"    value={`${metrics.tickMs} ms`}            valueWidth={63} color={tickColor(metrics.tickMs)} />
      {metrics.memoryMb !== null && (
        <>
          <Divider>|</Divider>
          {/* "9999 MB" → 7 chars → ~63px */}
          <Metric label="MEM"     value={`${metrics.memoryMb} MB`}      valueWidth={63} />
        </>
      )}
      <Divider>|</Divider>
      {/* 4 digits max → ~36px */}
      <Metric label="BODIES"  value={String(metrics.physicsBodyCount)}  valueWidth={36} />
      <Divider>|</Divider>
      <Metric label="SHIPS"   value={String(metrics.assemblyCount)}     valueWidth={27} />
      <Divider>|</Divider>
      <Metric label="ENTS"    value={String(metrics.entityCount)}       valueWidth={36} />
      <Divider>|</Divider>
      <Metric label="LASERS"  value={String(metrics.laserCount)}        valueWidth={27} />
      <Divider>|</Divider>
      <Metric label="MSL"     value={String(metrics.missileCount)}      valueWidth={27} />
      <Divider>|</Divider>
      {/* "9999" collisions/s → ~36px */}
      <Metric label="COLL/s"  value={String(metrics.collisionsPerSecond)} valueWidth={36} />
    </Bar>
  );
};

export default PerformanceBar;
