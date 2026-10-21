'use client';

// The 14 "install the app" scenes. Each is a pure SVG drawing whose only inputs
// are the labels (UI language) and the accessible description of the step.
// See parts.tsx for the shared visual language.

import type { ComponentType, ReactNode } from 'react';
import { ART_HOST, type InstallArtLabels } from './labels';
import {
  AppIcon,
  ArtSvg,
  Bar,
  Button,
  btnW,
  C,
  ClippedLabel,
  GhostIcon,
  Glyph,
  Highlight,
  Label,
  LoginCard,
  PhoneFrame,
  Popover,
  RING,
  StatusBar,
  STROKE,
  T,
  textW,
  Veil,
  Window,
  phoneScreen,
} from './parts';

export type SceneProps = { labels: InstallArtLabels; ariaLabel: string };
export type GuidePlatform = 'pc' | 'ios' | 'mac' | 'android';

/* ════════════════════════════════════════════════════════════════════
   Phone geometry (viewBox 280 x 360)
   ════════════════════════════════════════════════════════════════════ */

const TOP = phoneScreen('top');
const BOT = phoneScreen('bottom');
const SX = TOP.x; // 28
const SW = TOP.w; // 224
const SR = SX + SW; // 252
const SCX = SX + SW / 2; // 140

/* ── iOS ─────────────────────────────────────────────────────────── */

/** Safari's bottom bar: address pill + toolbar + home indicator. */
function IosSafariBar({ highlightShare }: { highlightShare: boolean }) {
  const barY = 252;
  const toolY = 314;
  const xs = [0, 1, 2, 3, 4].map(i => SX + (SW * (i + 0.5)) / 5);
  const share = (
    <Glyph.share x={xs[2]} y={toolY} color={highlightShare ? C.text : C.muted} />
  );
  return (
    <g>
      <rect x={SX} y={barY} width={SW} height={120} fill={C.surface2} />
      <line x1={SX} y1={barY} x2={SR} y2={barY} stroke={C.border} strokeWidth={STROKE} />
      <rect x={SX + 14} y={barY + 10} width={SW - 28} height={28} rx={10} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
      <Glyph.lock x={SX + 30} y={barY + 24} s={0.85} />
      <ClippedLabel box={{ x: SX + 40, y: barY + 10, w: SW - 80, h: 28 }} x={SCX + 4} y={barY + 24} anchor="middle">
        {ART_HOST}
      </ClippedLabel>
      <Glyph.reload x={SR - 30} y={barY + 24} s={0.8} />
      <Glyph.back x={xs[0]} y={toolY} />
      <Glyph.forward x={xs[1]} y={toolY} color={C.border} />
      {highlightShare ? (
        <Highlight box={{ x: xs[2] - 16, y: toolY - 15, w: 32, h: 30, r: 8 }} pointer={{ kind: 'tap' }}>
          {share}
        </Highlight>
      ) : (
        share
      )}
      <Glyph.book x={xs[3]} y={toolY} />
      <Glyph.tabs x={xs[4]} y={toolY} />
      <rect x={SCX - 46} y={338} width={92} height={4} rx={2} fill={C.text} opacity={0.7} />
    </g>
  );
}

function IosPage() {
  return (
    <g>
      <rect x={SX} y={BOT.y} width={SW} height={360} fill={C.bg} />
      <LoginCard cx={SCX} y={92} w={152} />
    </g>
  );
}

export function IosShare({ ariaLabel }: SceneProps) {
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="ios" anchor="bottom">
        <IosPage />
        <IosSafariBar highlightShare />
      </PhoneFrame>
    </ArtSvg>
  );
}

export function IosShareSheet({ labels, ariaLabel }: SceneProps) {
  const sheetY = 66;
  const listX = SX + 14;
  const listW = SW - 28;
  const rowH = 34;
  const listY = 188;
  const rows: { label: string | null; glyph: 'copy' | 'book' | 'plusSquare' | 'star' }[] = [
    { label: labels.copy, glyph: 'copy' },
    { label: labels.addBookmark, glyph: 'book' },
    { label: labels.addToHomeScreen, glyph: 'plusSquare' },
    { label: null, glyph: 'star' },
  ];
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="ios" anchor="bottom">
        <IosPage />
        <IosSafariBar highlightShare={false} />
        <Veil x={SX} y={BOT.y} w={SW} h={430} opacity={0.65} />
        <rect x={SX} y={sheetY} width={SW} height={320} rx={18} fill={C.surface2} stroke={C.border} strokeWidth={STROKE} />
        {/* header: what is being shared */}
        <AppIcon x={SX + 14} y={sheetY + 14} size={32} />
        <Label x={SX + 56} y={sheetY + 23} size={T.body} weight={600} fill={C.text}>Kafé OS</Label>
        <ClippedLabel box={{ x: SX + 56, y: sheetY + 30, w: SW - 70, h: 18 }} x={SX + 56} y={sheetY + 39} fill={C.text}>
          {ART_HOST}
        </ClippedLabel>
        <line x1={SX + 14} y1={sheetY + 58} x2={SR - 14} y2={sheetY + 58} stroke={C.border} strokeWidth={STROKE} />
        {/* share targets */}
        {[0, 1, 2, 3, 4].map(i => {
          const cx = SX + 34 + i * 39;
          return (
            <g key={i}>
              <GhostIcon x={cx - 16} y={sheetY + 68} size={32} shape="circle" glyph={i} />
              <Bar x={cx - 12} y={sheetY + 110} w={24} h={5} />
            </g>
          );
        })}
        {/* action list */}
        <rect x={listX} y={listY} width={listW} height={rowH * rows.length} rx={12} fill={C.surface} />
        {/* separators first (none touching the target row), target row drawn last
            so nothing paints over its ring or pointer */}
        {[1, 2, 3].map(i =>
          i === 2 || i === 3 ? null : (
            <line key={`sep-${i}`} x1={listX + 12} y1={listY + i * rowH} x2={listX + listW} y2={listY + i * rowH} stroke={C.border} strokeWidth={1} />
          ),
        )}
        {[0, 1, 3, 2].map(i => {
          const row = rows[i];
          const y = listY + i * rowH;
          const cy = y + rowH / 2;
          const target = i === 2;
          const G = Glyph[row.glyph];
          const content = (
            <g>
              {row.label ? (
                <Label x={listX + 12} y={cy} fill={target ? C.text : C.text2} weight={target ? 600 : 400}>{row.label}</Label>
              ) : (
                <Bar x={listX + 12} y={cy} w={92} />
              )}
              <G x={listX + listW - 18} y={cy} color={target ? C.text : C.muted} s={0.9} />
            </g>
          );
          return (
            <g key={i}>
              {target ? (
                <Highlight
                  box={{ x: listX + 2, y: y + 2, w: listW - 4, h: rowH - 4, r: 8 }}
                  pad={1}
                  pointer={{ kind: 'tap' }}
                >
                  {content}
                </Highlight>
              ) : (
                content
              )}
            </g>
          );
        })}
        <rect x={SCX - 46} y={338} width={92} height={4} rx={2} fill={C.text} opacity={0.7} />
      </PhoneFrame>
    </ArtSvg>
  );
}

export function IosAddScreen({ labels, ariaLabel }: SceneProps) {
  const navY = 70;
  const addW = textW(labels.add, T.body, true);
  const addX = SR - 14 - addW;
  const cardX = SX + 14;
  const cardW = SW - 28;
  const cardY = 100;
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="ios" anchor="top" screenFill={C.surface2}>
        <StatusBar os="ios" y={TOP.y} />
        {/* nav bar */}
        <Label x={SX + 14} y={navY} fill={C.text}>{labels.cancel}</Label>
        {/* title centred in the space left between the two nav buttons */}
        <Label
          x={(SX + 14 + textW(labels.cancel, T.body) + addX - 6) / 2}
          y={navY}
          size={T.body}
          weight={600}
          fill={C.text}
          anchor="middle"
        >
          {labels.addToHomeScreen}
        </Label>
        <Highlight box={{ x: addX - 6, y: navY - 11, w: addW + 12, h: 22, r: 7 }} pointer={{ kind: 'tap' }}>
          <Label x={addX} y={navY} weight={700} fill={C.text}>{labels.add}</Label>
        </Highlight>
        <line x1={SX} y1={navY + 18} x2={SR} y2={navY + 18} stroke={C.border} strokeWidth={STROKE} />
        {/* app card */}
        <rect x={cardX} y={cardY} width={cardW} height={86} rx={12} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
        <AppIcon x={cardX + 12} y={cardY + 12} size={42} />
        <rect x={cardX + 66} y={cardY + 16} width={cardW - 78} height={24} rx={6} fill={C.surface2} stroke={C.borderStrong} strokeWidth={STROKE} />
        <Label x={cardX + 74} y={cardY + 28} fill={C.text}>Kafé OS</Label>
        <line
          x1={cardX + 76 + textW('Kafé OS', T.body)}
          y1={cardY + 21}
          x2={cardX + 76 + textW('Kafé OS', T.body)}
          y2={cardY + 35}
          style={{ stroke: RING }}
          strokeWidth={1.5}
        />
        <ClippedLabel box={{ x: cardX + 12, y: cardY + 60, w: cardW - 24, h: 20 }} x={cardX + 12} y={cardY + 70} fill={C.muted}>
          {ART_HOST}
        </ClippedLabel>
        <Bar x={cardX + 4} y={cardY + 104} w={cardW - 30} h={5} />
        <Bar x={cardX + 4} y={cardY + 116} w={cardW - 90} h={5} />
        {/* keyboard */}
        <rect x={SX} y={244} width={SW} height={200} fill={C.surface} />
        <line x1={SX} y1={244} x2={SR} y2={244} stroke={C.border} strokeWidth={STROKE} />
        {[10, 9, 7].map((n, row) => {
          const kw = 18;
          const gap = 3.6;
          const total = n * kw + (n - 1) * gap;
          const x0 = SCX - total / 2;
          return Array.from({ length: n }, (_, k) => (
            <rect key={`${row}-${k}`} x={x0 + k * (kw + gap)} y={254 + row * 32} width={kw} height={26} rx={5} fill={C.surface2} stroke={C.border} strokeWidth={1} />
          ));
        })}
      </PhoneFrame>
    </ArtSvg>
  );
}

/** Home-screen grid shared by iOS and Android. The Kafe OS icon takes `target` slot. */
function HomeGrid({
  shape,
  top,
  rows,
  lastRowCount,
}: {
  shape: 'squircle' | 'circle';
  top: number;
  rows: number;
  lastRowCount: number;
}) {
  const size = 40;
  const colX = (c: number) => SX + 36 + c * 50.7;
  const rowY = (r: number) => top + r * 64;
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const n = r === rows - 1 ? lastRowCount : 4;
    for (let c = 0; c < n; c++) cells.push({ r, c });
  }
  const kr = rows - 1;
  const kc = lastRowCount;
  const kx = colX(kc);
  const ky = rowY(kr);
  return (
    <g>
      {cells.map(({ r, c }, i) => (
        <g key={i}>
          <GhostIcon x={colX(c) - size / 2} y={rowY(r)} size={size} shape={shape} glyph={i} />
          <Bar x={colX(c) - 13} y={rowY(r) + 51} w={26} h={5} />
        </g>
      ))}
      <Highlight box={{ x: kx - 28, y: ky - 5, w: 56, h: 64, r: 12 }} pointer={{ kind: 'tap', x: kx + 32, y: ky + 66 }}>
        <AppIcon x={kx - size / 2} y={ky} size={size} shape={shape} />
        <Label x={kx} y={ky + 51} size={T.meta} weight={600} fill={C.text} anchor="middle">Kafé OS</Label>
      </Highlight>
    </g>
  );
}

export function IosHome({ ariaLabel }: SceneProps) {
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="ios" anchor="top" screenFill={C.surface2}>
        <StatusBar os="ios" y={TOP.y} />
        <HomeGrid shape="squircle" top={66} rows={4} lastRowCount={2} />
      </PhoneFrame>
    </ArtSvg>
  );
}

/* ── Android ─────────────────────────────────────────────────────── */

const A_BAR_Y = 46;
const A_BAR_H = 36;

function AndroidChrome({ highlightMenu }: { highlightMenu: boolean }) {
  const cy = A_BAR_Y + A_BAR_H / 2;
  const pillX = SX + 10;
  const pillW = 150;
  const tabX = pillX + pillW + 10;
  const menuX = SR - 18;
  const kebab = <Glyph.kebab x={menuX} y={cy} color={highlightMenu ? C.text : C.muted} s={1.05} />;
  return (
    <g>
      <rect x={SX} y={TOP.y} width={SW} height={A_BAR_Y + A_BAR_H - TOP.y} fill={C.surface} />
      <line x1={SX} y1={A_BAR_Y + A_BAR_H} x2={SR} y2={A_BAR_Y + A_BAR_H} stroke={C.border} strokeWidth={STROKE} />
      <rect x={pillX} y={cy - 14} width={pillW} height={28} rx={14} fill={C.surface} stroke={C.borderStrong} strokeWidth={1} />
      <ClippedLabel box={{ x: pillX + 8, y: cy - 14, w: pillW - 16, h: 28 }} x={pillX + 12} y={cy}>
        {ART_HOST}
      </ClippedLabel>
      <rect x={tabX} y={cy - 8} width={17} height={16} rx={4} fill="none" stroke={C.muted} strokeWidth={1.5} />
      <Label x={tabX + 8.5} y={cy + 0.5} size={T.meta} weight={600} fill={C.text2} anchor="middle">2</Label>
      {highlightMenu ? (
        <Highlight box={{ x: menuX - 10, y: cy - 13, w: 20, h: 26, r: 8 }} pointer={{ kind: 'tap', x: menuX - 10, y: cy + 17 }}>
          {kebab}
        </Highlight>
      ) : (
        <>
          <rect x={menuX - 12} y={cy - 14} width={24} height={28} rx={8} fill={C.surface2} />
          {kebab}
        </>
      )}
    </g>
  );
}

function AndroidPage() {
  return <LoginCard cx={SCX} y={112} w={160} />;
}

export function AndroidMenuButton({ ariaLabel }: SceneProps) {
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="android" anchor="top">
        <AndroidPage />
        <AndroidChrome highlightMenu />
        <StatusBar os="android" y={TOP.y} />
      </PhoneFrame>
    </ArtSvg>
  );
}

export function AndroidMenu({ labels, ariaLabel }: SceneProps) {
  const mw = 156;
  const mx = SR - 8 - mw;
  const my = A_BAR_Y + 2;
  const rowH = 32;
  const iconRowH = 36;
  const rows: { label: string | null; glyph: keyof typeof Glyph }[] = [
    { label: labels.androidNewTab, glyph: 'newTab' },
    { label: labels.history, glyph: 'clock' },
    { label: labels.bookmarks, glyph: 'star' },
    { label: null, glyph: 'download' },
    { label: labels.installApp, glyph: 'phoneDown' },
    { label: null, glyph: 'info' },
  ];
  const targetIndex = 4;
  const mh = iconRowH + rows.length * rowH + 8;
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="android" anchor="top">
        <AndroidPage />
        <AndroidChrome highlightMenu={false} />
        <StatusBar os="android" y={TOP.y} />
        <Popover x={mx} y={my} w={mw} h={mh} r={10} />
        {(['forward', 'star', 'download', 'info', 'reload'] as const).map((k, i) => {
          const G = Glyph[k];
          return <G key={k} x={mx + 18 + i * 30} y={my + iconRowH / 2 + 2} s={0.85} />;
        })}
        <line x1={mx} y1={my + iconRowH + 2} x2={mx + mw} y2={my + iconRowH + 2} stroke={C.border} strokeWidth={1} />
        {rows.map((row, i) => {
          const y = my + iconRowH + 4 + i * rowH;
          const cy = y + rowH / 2;
          const target = i === targetIndex;
          const G = Glyph[row.glyph];
          const content = (
            <g>
              <G x={mx + 20} y={cy} color={target ? C.text : C.muted} s={0.9} />
              {row.label ? (
                <Label x={mx + 38} y={cy} fill={target ? C.text : C.text2} weight={target ? 600 : 400}>{row.label}</Label>
              ) : (
                <Bar x={mx + 38} y={cy} w={70} />
              )}
            </g>
          );
          return target ? (
            <Highlight key={i} box={{ x: mx + 4, y: y + 2, w: mw - 8, h: rowH - 4, r: 7 }} pad={1} pointer={{ kind: 'tap' }}>
              {content}
            </Highlight>
          ) : (
            <g key={i}>{content}</g>
          );
        })}
      </PhoneFrame>
    </ArtSvg>
  );
}

export function AndroidInstallDialog({ labels, ariaLabel }: SceneProps) {
  const dx = SX + 16;
  const dw = SW - 32;
  const dy = 118;
  const dh = 168;
  const instW = btnW(labels.install, T.body, 64);
  const cancelW = btnW(labels.cancel, T.body, 56);
  const by = dy + dh - 44;
  const instX = dx + dw - 16 - instW;
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="android" anchor="top">
        <AndroidPage />
        <AndroidChrome highlightMenu={false} />
        <StatusBar os="android" y={TOP.y} />
        <Veil x={SX} y={TOP.y} w={SW} h={430} opacity={0.7} />
        <Popover x={dx} y={dy} w={dw} h={dh} r={20} fill={C.surface} />
        <Label x={dx + 18} y={dy + 24} size={T.title} weight={600} fill={C.text}>{labels.installApp}</Label>
        <AppIcon x={dx + 18} y={dy + 44} size={40} shape="circle" />
        <Label x={dx + 68} y={dy + 64} weight={600} fill={C.text}>Kafé OS</Label>
        <ClippedLabel box={{ x: dx + 18, y: dy + 88, w: dw - 36, h: 20 }} x={dx + 18} y={dy + 98} fill={C.muted}>
          {ART_HOST}
        </ClippedLabel>
        <Button x={instX - 8 - cancelW} y={by} w={cancelW} h={30} label={labels.cancel} tone="text" />
        <Highlight box={{ x: instX, y: by, w: instW, h: 30, r: 15 }} pointer={{ kind: 'tap' }}>
          <Button x={instX} y={by} w={instW} h={30} label={labels.install} tone="primary" />
        </Highlight>
      </PhoneFrame>
    </ArtSvg>
  );
}

export function AndroidHome({ ariaLabel }: SceneProps) {
  return (
    <ArtSvg kind="phone" ariaLabel={ariaLabel}>
      <PhoneFrame os="android" anchor="top" screenFill={C.surface2}>
        <StatusBar os="android" y={TOP.y} />
        {/* generic search widget (no logos) */}
        <rect x={SX + 16} y={60} width={SW - 32} height={30} rx={15} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
        <circle cx={SX + 34} cy={75} r={5} fill="none" stroke={C.muted} strokeWidth={1.6} />
        <line x1={SX + 38} y1={79} x2={SX + 41} y2={82} stroke={C.muted} strokeWidth={1.6} strokeLinecap="round" />
        <Bar x={SX + 50} y={75} w={70} h={5} />
        <HomeGrid shape="circle" top={110} rows={3} lastRowCount={2} />
      </PhoneFrame>
    </ArtSvg>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Desktop geometry (viewBox 320 x 216)
   ════════════════════════════════════════════════════════════════════ */

/** The monitor / screen the desktop scenes sit on. */
function Desk({ children }: { children: ReactNode }) {
  return (
    <Window x={0.75} y={0.75} w={318.5} h={214.5}>
      <rect x={0} y={0} width={320} height={216} fill={C.surface2} />
      {children}
    </Window>
  );
}

/** Generic window controls (minimise / maximise / close as plain strokes). */
function WinControls({ right, cy }: { right: number; cy: number }) {
  const col = C.muted;
  return (
    <g stroke={col} strokeWidth={1.3} strokeLinecap="round" fill="none" aria-hidden="true">
      <path d={`M ${right - 52} ${cy} H ${right - 44}`} />
      <rect x={right - 32} y={cy - 4} width={8} height={8} rx={1} />
      <path d={`M ${right - 12} ${cy - 4} L ${right - 4} ${cy + 4} M ${right - 4} ${cy - 4} L ${right - 12} ${cy + 4}`} />
    </g>
  );
}

const PCW = { x: 10, y: 10, w: 300, h: 196 } as const;
const PC_TAB_H = 26;
const PC_BAR_H = 30;

/** Desktop browser window (pc-1 / pc-2). */
function PcBrowser({ installState, children }: { installState: 'target' | 'pressed'; children?: ReactNode }) {
  const { x, y, w, h } = PCW;
  const barY = y + PC_TAB_H;
  const cy = barY + PC_BAR_H / 2;
  const pillX = x + 74;
  const pillW = w - 84;
  const instX = pillX + pillW - 16;
  return (
    <Window x={x} y={y} w={w} h={h}>
      {/* tab strip */}
      <rect x={x} y={y} width={w} height={PC_TAB_H} fill={C.surface2} />
      <path d={`M ${x + 8} ${y + PC_TAB_H} V ${y + 9} a 5 5 0 0 1 5 -5 H ${x + 112} a 5 5 0 0 1 5 5 V ${y + PC_TAB_H} Z`} fill={C.surface} />
      <AppIcon x={x + 16} y={y + 9} size={13} />
      <Label x={x + 35} y={y + 16} size={T.meta} fill={C.text2}>Kafé OS</Label>
      <path d={`M ${x + 101} ${y + 12.5} l 6 6 m 0 -6 l -6 6`} stroke={C.muted} strokeWidth={1.2} strokeLinecap="round" />
      <path d={`M ${x + 130} ${y + 15.5} h 9 m -4.5 -4.5 v 9`} stroke={C.muted} strokeWidth={1.4} strokeLinecap="round" />
      <WinControls right={x + w - 8} cy={y + 14} />
      {/* toolbar */}
      <rect x={x} y={barY} width={w} height={PC_BAR_H} fill={C.surface} />
      <line x1={x} y1={barY + PC_BAR_H} x2={x + w} y2={barY + PC_BAR_H} stroke={C.border} strokeWidth={STROKE} />
      <Glyph.back x={x + 16} y={cy} s={0.85} />
      <Glyph.forward x={x + 36} y={cy} s={0.85} color={C.border} />
      <Glyph.reload x={x + 57} y={cy} s={0.8} />
      <rect x={pillX} y={cy - 11} width={pillW} height={22} rx={11} fill={C.surface} stroke={C.borderStrong} strokeWidth={1} />
      <Glyph.lock x={pillX + 12} y={cy} s={0.8} />
      <ClippedLabel box={{ x: pillX + 20, y: cy - 11, w: pillW - 52, h: 22 }} x={pillX + 22} y={cy}>
        {ART_HOST}
      </ClippedLabel>
      {/* page */}
      <rect x={x} y={barY + PC_BAR_H} width={w} height={h} fill={C.bg} />
      <LoginCard cx={x + w / 2} y={barY + PC_BAR_H + 14} w={124} />
      {children}
      {installState === 'target' ? (
        <InstallTarget instX={instX} cy={cy} />
      ) : (
        <>
          <rect x={instX - 10} y={cy - 9} width={20} height={18} rx={6} fill={C.border} />
          <Glyph.installPc x={instX} y={cy} s={0.75} color={C.text2} />
        </>
      )}
    </Window>
  );
}

function InstallTarget({ instX, cy }: { instX: number; cy: number }) {
  return (
    <Highlight box={{ x: instX - 10, y: cy - 9, w: 20, h: 18, r: 6 }} pointer={{ kind: 'cursor' }}>
      <Glyph.installPc x={instX} y={cy} s={0.75} color={C.text} />
    </Highlight>
  );
}

export function PcAddressBar({ labels, ariaLabel }: SceneProps) {
  const cy = PCW.y + PC_TAB_H + PC_BAR_H / 2;
  const instX = PCW.x + 74 + (PCW.w - 84) - 16;
  const tipW = textW(labels.pcInstallTip, T.meta) + 20;
  const tipX = Math.min(instX + 10, PCW.x + PCW.w - 6) - tipW;
  const tipY = cy + 22;
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <PcBrowser installState="target">
          {/* tooltip under the install button */}
          <path d={`M ${instX - 5} ${tipY} L ${instX} ${tipY - 5} L ${instX + 5} ${tipY} Z`} fill={C.text} />
          <rect x={tipX} y={tipY} width={tipW} height={22} rx={6} fill={C.text} />
          <Label x={tipX + tipW / 2} y={tipY + 11} size={T.meta} weight={500} fill={C.surface} anchor="middle">{labels.pcInstallTip}</Label>
        </PcBrowser>
      </Desk>
    </ArtSvg>
  );
}

export function PcInstallPopup({ labels, ariaLabel }: SceneProps) {
  const px = 92;
  const pw = PCW.x + PCW.w - 8 - px;
  const py = PCW.y + PC_TAB_H + PC_BAR_H + 2;
  const ph = 104;
  const instW = btnW(labels.install);
  const cancelW = btnW(labels.cancel);
  const by = py + ph - 38;
  const instX = px + pw - 14 - instW;
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <PcBrowser installState="pressed">
          <Popover x={px} y={py} w={pw} h={ph} r={10} />
          <AppIcon x={px + 14} y={py + 14} size={34} />
          <Label x={px + 58} y={py + 23} size={T.title} weight={600} fill={C.text}>Kafé OS</Label>
          <ClippedLabel box={{ x: px + 58, y: py + 30, w: pw - 66, h: 18 }} x={px + 58} y={py + 40} fill={C.muted}>
            {ART_HOST}
          </ClippedLabel>
          <Button x={instX - 8 - cancelW} y={by} w={cancelW} label={labels.cancel} tone="ghost" />
          <Highlight box={{ x: instX, y: by, w: instW, h: 26, r: 8 }} pointer={{ kind: 'cursor' }}>
            <Button x={instX} y={by} w={instW} label={labels.install} tone="primary" />
          </Highlight>
        </PcBrowser>
      </Desk>
    </ArtSvg>
  );
}

export function PcAppWindow({ ariaLabel }: SceneProps) {
  const wx = 22;
  const wy = 12;
  const ww = 276;
  const wh = 158;
  const tbH = 26;
  const taskY = 180;
  const icons = 5;
  const isz = 24;
  const gap = 10;
  const total = icons * isz + (icons - 1) * gap;
  const ix0 = 160 - total / 2;
  const kafeIndex = 3;
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <Window x={wx} y={wy} w={ww} h={wh}>
          <rect x={wx} y={wy} width={ww} height={tbH} fill={C.surface} />
          <line x1={wx} y1={wy + tbH} x2={wx + ww} y2={wy + tbH} stroke={C.border} strokeWidth={STROKE} />
          <AppIcon x={wx + 10} y={wy + 6} size={14} />
          <Label x={wx + 30} y={wy + 13} size={T.meta} weight={600} fill={C.text2}>Kafé OS</Label>
          <WinControls right={wx + ww - 8} cy={wy + 13} />
          {/* simplified POS screen, muted */}
          <rect x={wx} y={wy + tbH} width={52} height={wh - tbH} fill={C.surface2} />
          {[0, 1, 2, 3].map(i => (
            <Bar key={i} x={wx + 12} y={wy + tbH + 18 + i * 18} w={28} h={6} />
          ))}
          {[0, 1, 2].map(c =>
            [0, 1].map(r => (
              <rect
                key={`${c}-${r}`}
                x={wx + 62 + c * 46}
                y={wy + tbH + 12 + r * 56}
                width={40}
                height={48}
                rx={8}
                fill={C.surface}
                stroke={C.border}
                strokeWidth={1}
              />
            )),
          )}
          <rect x={wx + ww - 70} y={wy + tbH + 12} width={60} height={wh - tbH - 22} rx={8} fill={C.surface} stroke={C.border} strokeWidth={1} />
          <Bar x={wx + ww - 62} y={wy + tbH + 26} w={40} />
          <Bar x={wx + ww - 62} y={wy + tbH + 40} w={30} />
          <rect x={wx + ww - 62} y={wy + wh - 38} width={44} height={16} rx={8} fill={C.border} />
        </Window>
        {/* taskbar */}
        <rect x={0} y={taskY} width={320} height={40} fill={C.surface} />
        <line x1={0} y1={taskY} x2={320} y2={taskY} stroke={C.border} strokeWidth={STROKE} />
        {Array.from({ length: icons }, (_, i) => {
          const x = ix0 + i * (isz + gap);
          if (i === kafeIndex) return null;
          return <GhostIcon key={i} x={x} y={taskY + 6} size={isz} glyph={i} />;
        })}
        <Label x={306} y={taskY + 18} size={T.meta} fill={C.muted} anchor="end">9:41</Label>
        {(() => {
          const x = ix0 + kafeIndex * (isz + gap);
          return (
            <Highlight box={{ x: x - 3, y: taskY + 3, w: isz + 6, h: isz + 6 + 3, r: 7 }} pointer={{ kind: 'cursor' }}>
              <AppIcon x={x} y={taskY + 6} size={isz} />
              <rect x={x + isz / 2 - 5} y={taskY + 32} width={10} height={2.5} rx={1.25} fill={C.text} />
            </Highlight>
          );
        })()}
      </Desk>
    </ArtSvg>
  );
}

/* ── Mac ─────────────────────────────────────────────────────────── */

const MENU_H = 22;

/** Menu bar items laid out by label width. Returns x positions + widths. */
function menuLayout(labels: InstallArtLabels) {
  const items = [
    { key: 'app', label: labels.safariMenu, bold: true },
    { key: 'file', label: labels.file, bold: false },
    { key: 'edit', label: labels.edit, bold: false },
    { key: 'view', label: labels.view, bold: false },
  ];
  let x = 14;
  return items.map(it => {
    const w = textW(it.label, T.body, it.bold);
    const out = { ...it, x, w };
    x += w + 16;
    return out;
  });
}

function MacMenuBar({ labels, fileState }: { labels: InstallArtLabels; fileState: 'target' | 'open' | 'idle' }) {
  const items = menuLayout(labels);
  const cy = MENU_H / 2;
  return (
    <g>
      <rect x={0} y={0} width={320} height={MENU_H} fill={C.surface} />
      <line x1={0} y1={MENU_H} x2={320} y2={MENU_H} stroke={C.border} strokeWidth={STROKE} />
      {items.map(it => {
        const label = (
          <Label
            x={it.x}
            y={cy}
            weight={it.bold ? 700 : it.key === 'file' && fileState !== 'idle' ? 600 : 400}
            fill={it.bold || (it.key === 'file' && fileState !== 'idle') ? C.text : C.text2}
          >
            {it.label}
          </Label>
        );
        if (it.key === 'file' && fileState === 'target') {
          return (
            <Highlight key={it.key} box={{ x: it.x - 6, y: 3, w: it.w + 12, h: MENU_H - 6, r: 5 }} pad={1} pointer={{ kind: 'cursor' }}>
              {label}
            </Highlight>
          );
        }
        if (it.key === 'file' && fileState === 'open') {
          return (
            <g key={it.key}>
              <rect x={it.x - 6} y={3} width={it.w + 12} height={MENU_H - 6} rx={5} fill={C.border} />
              {label}
            </g>
          );
        }
        return <g key={it.key}>{label}</g>;
      })}
      {/* right side: neutral status glyphs + clock */}
      <rect x={250} y={cy - 4} width={14} height={8} rx={2} fill="none" stroke={C.muted} strokeWidth={1.2} />
      <Label x={306} y={cy} size={T.meta} fill={C.muted} anchor="end">9:41</Label>
    </g>
  );
}

const MACW = { x: 30, y: 34, w: 260, h: 170 } as const;

function MacSafari() {
  const { x, y, w, h } = MACW;
  const tb = 28;
  const cy = y + tb / 2;
  const pillX = x + 96;
  const pillW = w - 108;
  return (
    <Window x={x} y={y} w={w} h={h}>
      <rect x={x} y={y} width={w} height={tb} fill={C.surface} />
      <line x1={x} y1={y + tb} x2={x + w} y2={y + tb} stroke={C.border} strokeWidth={STROKE} />
      {[0, 1, 2].map(i => (
        <circle key={i} cx={x + 14 + i * 12} cy={cy} r={4} fill={C.border} stroke={C.borderStrong} strokeWidth={0.8} />
      ))}
      <Glyph.back x={x + 62} y={cy} s={0.75} />
      <Glyph.forward x={x + 78} y={cy} s={0.75} color={C.border} />
      <rect x={pillX} y={cy - 9.5} width={pillW} height={19} rx={6} fill={C.surface} stroke={C.borderStrong} strokeWidth={1} />
      <ClippedLabel box={{ x: pillX + 4, y: cy - 9.5, w: pillW - 8, h: 19 }} x={pillX + pillW / 2} y={cy} anchor="middle">
        {ART_HOST}
      </ClippedLabel>
      <rect x={x} y={y + tb} width={w} height={h - tb} fill={C.bg} />
      <LoginCard cx={x + w / 2} y={y + tb + 12} w={120} />
    </Window>
  );
}

export function MacFileMenu({ labels, ariaLabel }: SceneProps) {
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <MacSafari />
        <MacMenuBar labels={labels} fileState="target" />
      </Desk>
    </ArtSvg>
  );
}

export function MacAddToDock({ labels, ariaLabel }: SceneProps) {
  const file = menuLayout(labels)[1];
  const mx = file.x - 6;
  const my = MENU_H + 1;
  const mw = 172;
  const rowH = 22;
  const rows: (string | null | 'sep')[] = [labels.newWindow, labels.newTab, 'sep', labels.addToDock, null, null, 'sep', null];
  let y = my + 5;
  const placed = rows.map(r => {
    const h = r === 'sep' ? 9 : rowH;
    const out = { r, y, h };
    y += h;
    return out;
  });
  const mh = y - my + 5;
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <MacSafari />
        <MacMenuBar labels={labels} fileState="open" />
        <Popover x={mx} y={my} w={mw} h={mh} r={8} />
        {placed.map(({ r, y: ry, h }, i) => {
          if (r === 'sep') return <line key={i} x1={mx + 10} y1={ry + h / 2} x2={mx + mw - 10} y2={ry + h / 2} stroke={C.border} strokeWidth={1} />;
          const cy = ry + h / 2;
          if (r === null) return <Bar key={i} x={mx + 14} y={cy} w={i % 2 ? 84 : 104} h={5} />;
          if (r === labels.addToDock) {
            return (
              <Highlight key={i} box={{ x: mx + 5, y: ry + 1, w: mw - 10, h: h - 2, r: 5 }} pad={1} pointer={{ kind: 'cursor' }}>
                <Label x={mx + 14} y={cy} weight={600} fill={C.text}>{r}</Label>
              </Highlight>
            );
          }
          return <Label key={i} x={mx + 14} y={cy} fill={C.text2}>{r}</Label>;
        })}
      </Desk>
    </ArtSvg>
  );
}

export function MacConfirmDock({ labels, ariaLabel }: SceneProps) {
  const sx = 72;
  const sw = 176;
  const sy = 30;
  const sh = 112;
  const addW = btnW(labels.add, T.body, 56);
  const cancelW = btnW(labels.cancel, T.body, 56);
  const by = sy + sh - 36;
  const addX = sx + sw - 12 - addW;
  // Dock
  const n = 6;
  const isz = 24;
  const gap = 7;
  const dockW = n * isz + (n - 1) * gap + 20;
  const dockX = 160 - dockW / 2;
  const dockY = 170;
  const kafe = n - 1;
  return (
    <ArtSvg kind="desktop" ariaLabel={ariaLabel}>
      <Desk>
        <MacSafari />
        <MacMenuBar labels={labels} fileState="idle" />
        <Veil x={0} y={MENU_H + 1} w={320} h={216} opacity={0.6} />
        {/* confirm sheet */}
        <Popover x={sx} y={sy} w={sw} h={sh} r={12} />
        <AppIcon x={sx + 12} y={sy + 12} size={36} />
        <rect x={sx + 58} y={sy + 16} width={sw - 70} height={22} rx={6} fill={C.surface2} stroke={C.borderStrong} strokeWidth={STROKE} />
        <Label x={sx + 66} y={sy + 27} fill={C.text}>Kafé OS</Label>
        <ClippedLabel box={{ x: sx + 12, y: sy + 50, w: sw - 24, h: 18 }} x={sx + 12} y={sy + 59} fill={C.muted}>
          {ART_HOST}
        </ClippedLabel>
        <Button x={addX - 8 - cancelW} y={by} w={cancelW} h={24} label={labels.cancel} tone="ghost" />
        <Highlight box={{ x: addX, y: by, w: addW, h: 24, r: 8 }} pointer={{ kind: 'cursor' }}>
          <Button x={addX} y={by} w={addW} h={24} label={labels.add} tone="primary" />
        </Highlight>
        {/* Dock: the new icon arrives at the end, marked by a caramel indicator */}
        <rect x={dockX} y={dockY} width={dockW} height={38} rx={12} fill={C.surface} stroke={C.borderStrong} strokeWidth={STROKE} />
        {Array.from({ length: n }, (_, i) => {
          const x = dockX + 10 + i * (isz + gap);
          return i === kafe ? (
            <g key={i}>
              <AppIcon x={x} y={dockY + 6} size={isz} />
              <circle cx={x + isz / 2} cy={dockY + 34} r={2} style={{ fill: RING }} />
            </g>
          ) : (
            <GhostIcon key={i} x={x} y={dockY + 6} size={isz} glyph={i} />
          );
        })}
      </Desk>
    </ArtSvg>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Registry
   ════════════════════════════════════════════════════════════════════ */

type Scene = ComponentType<SceneProps>;

export const SCENES: Record<GuidePlatform, Scene[]> = {
  pc: [PcAddressBar, PcInstallPopup, PcAppWindow],
  ios: [IosShare, IosShareSheet, IosAddScreen, IosHome],
  mac: [MacFileMenu, MacAddToDock, MacConfirmDock],
  android: [AndroidMenuButton, AndroidMenu, AndroidInstallDialog, AndroidHome],
};

export const SCENE_ASPECT: Record<GuidePlatform, 'phone' | 'desktop'> = {
  pc: 'desktop',
  ios: 'phone',
  mac: 'desktop',
  android: 'phone',
};
