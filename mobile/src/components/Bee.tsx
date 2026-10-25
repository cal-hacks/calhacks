import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";
import { waggle } from "./theme";

/** The Waggle bee, drawn inline so it follows the theme. */
export function BeeLogo({ size = 96, label }: { size?: number; label?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel={label} accessible={!!label}>
      <G stroke={waggle.ink} strokeWidth={2}>
        <Ellipse cx="20" cy="13" rx="6" ry="9" transform="rotate(-25 20 13)" fill={waggle.card} />
        <Ellipse cx="29" cy="12" rx="5" ry="8" transform="rotate(20 29 12)" fill={waggle.card} />
        <Ellipse cx="24" cy="28" rx="15" ry="11" fill={waggle.honey} />
        <Path d="M19 18.6V37.4M26.5 17.8V38.2" strokeWidth={3} />
        <Circle cx="34" cy="25" r="1.8" fill={waggle.ink} stroke="none" />
        <Path d="M9 28H5" strokeLinecap="round" />
      </G>
    </Svg>
  );
}
