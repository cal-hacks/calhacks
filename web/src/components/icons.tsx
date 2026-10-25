import type { ReactNode, SVGProps } from "react";

// Inline stroke icons: ink, round caps, 2–2.6px strokes. No emoji in the chrome.

type IconProps = { size?: number; strokeWidth?: number; fill?: string } & Omit<SVGProps<SVGSVGElement>, "fill">;

function Svg({ size = 24, strokeWidth = 2, fill = "none", children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChatIcon = (p: IconProps) => <Svg {...p}><path d="M4 5h16v11H9l-5 4z" /></Svg>;
export const ShareIcon = (p: IconProps) => <Svg {...p}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M5 13v6h14v-6" /></Svg>;
export const ChartIcon = (p: IconProps) => <Svg {...p}><path d="M4 20h16" /><rect x="5.5" y="11" width="3" height="6" rx="1" /><rect x="10.5" y="6" width="3" height="11" rx="1" /><rect x="15.5" y="9" width="3" height="8" rx="1" /></Svg>;
export const TargetIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></Svg>;
export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 19.5c.9-3.4 3.3-5 6.5-5s5.6 1.6 6.5 5" />
    <path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .6 3.4 2.2 4 4.7" />
  </Svg>
);
export const PersonIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" /></Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>
);
export const PlusIcon = (p: IconProps) => <Svg strokeWidth={2.6} {...p}><path d="M12 5v14M5 12h14" /></Svg>;
