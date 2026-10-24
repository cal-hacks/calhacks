import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { useColors } from "./theme";
import { Txt } from "./ui";

export interface Bar {
  key: string;
  label: string;
  /** Shorter label for the x axis; omitted bars get no tick. */
  tick?: string;
  value: number;
  /** Readout text for the value, e.g. "2.5 h". */
  display: string;
}

/** Single-series column chart: hairline grid, 4px rounded caps, tap-to-inspect, table view. */
export function BarChart({ bars, title, unit, height = 190 }: { bars: Bar[]; title: string; unit: string; height?: number }) {
  const c = useColors();
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const pad = { top: 10, right: 4, bottom: 22, left: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rawMax = Math.max(...bars.map((b) => b.value), 1);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const band = innerW / Math.max(1, bars.length);
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const sel = selected !== null ? bars[selected] : null;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Txt bold>{title}</Txt>
        <Pressable onPress={() => setShowTable((v) => !v)} accessibilityRole="button" hitSlop={8}>
          <Txt small style={{ color: c.accent, fontWeight: "600" }}>{showTable ? "Show chart" : "Show table"}</Txt>
        </Pressable>
      </View>

      {showTable ? (
        <View>
          {bars.map((b) => (
            <View key={b.key} style={[styles.tableRow, { borderBottomColor: c.border }]}>
              <Txt small style={{ flex: 1 }}>{b.label}</Txt>
              <Txt small style={{ fontVariant: ["tabular-nums"] }}>{b.display}</Txt>
            </View>
          ))}
          <Txt small muted>{unit}</Txt>
        </View>
      ) : (
        <>
          <Txt small muted>{sel ? `${sel.label}: ${sel.display}` : "Tap a bar to see its value"}</Txt>
          <View onLayout={(e) => setWidth(Math.max(200, e.nativeEvent.layout.width))} accessible accessibilityLabel={`${title}. Use Show table for values.`}>
            <Svg width={width} height={height}>
              {ticks.map((t) => (
                <Line key={`g${t}`} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={c.grid} strokeWidth={1} />
              ))}
              {ticks.map((t) => (
                <SvgText key={`t${t}`} x={pad.left - 6} y={y(t) + 4} fontSize={10} fill={c.text2} textAnchor="end">
                  {Number.isInteger(t) ? String(t) : t.toFixed(1)}
                </SvgText>
              ))}
              {bars.map((b, i) => {
                const cx = pad.left + band * i + band / 2;
                const h = Math.max(0, y(0) - y(b.value));
                return b.value > 0 ? (
                  <Path
                    key={b.key}
                    d={roundedTop(cx - barW / 2, y(b.value), barW, h, Math.min(4, barW / 2, h))}
                    fill={c.series1}
                    opacity={selected === null || selected === i ? 1 : 0.5}
                  />
                ) : null;
              })}
              {bars.map((b, i) =>
                b.tick ? (
                  <SvgText key={`x${b.key}`} x={pad.left + band * i + band / 2} y={height - 6} fontSize={10} fill={c.text2} textAnchor="middle">
                    {b.tick}
                  </SvgText>
                ) : null,
              )}
              <Line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke={c.text3} strokeWidth={1} />
              {/* Tap targets span the whole band, taller than the mark. */}
              {bars.map((b, i) => (
                <Rect
                  key={`h${b.key}`}
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onPress={() => setSelected(selected === i ? null : i)}
                />
              ))}
            </Svg>
          </View>
        </>
      )}
    </View>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const styles = StyleSheet.create({
  tableRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
