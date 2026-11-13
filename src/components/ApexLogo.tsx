import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '../theme/tokens';

// Matches the owner-supplied assets/branding/apex-logo.svg without an SVG import plugin.
export function ApexLogo({ height = 30 }: { height?: number }) {
  return (
    <Svg
      width={(height * 180) / 150}
      height={(height * 190) / 150}
      viewBox="0 0 180 190"
    >
      <G transform="rotate(-17 90 75)">
        <G
          fill="none"
          stroke={colors.accent}
          strokeWidth={7}
          strokeLinejoin="round"
        >
          <Rect x={18} y={55} width={15} height={40} rx={2} />
          <Rect x={36} y={43} width={15} height={64} rx={2} />
          <Rect x={129} y={43} width={15} height={64} rx={2} />
          <Rect x={147} y={55} width={15} height={40} rx={2} />
          <Path d="M51 75 H70 M109 75 H129" />
        </G>
        <Path
          d="M96 19 L65 81 H87 L76 133 L117 65 H94 Z"
          fill={colors.accent}
        />
      </G>
      <SvgText
        x={90}
        y={174}
        textAnchor="middle"
        fill={colors.accent}
        fontFamily="Arial"
        fontSize={22}
        fontWeight="700"
        letterSpacing={5}
      >
        APEX
      </SvgText>
    </Svg>
  );
}
