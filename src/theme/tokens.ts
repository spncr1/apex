export const colors = {
  background: '#0B1220',
  surface: '#152238',
  surfaceElevated: '#1E304A',
  accent: '#FACC15',
  textPrimary: '#F8FAFC',
  textMuted: '#94A3B8',
  border: '#334155',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  textOnAccent: '#0B1220',
  modalBackdrop: 'rgba(0,0,0,0.7)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
} as const;

export const sizing = {
  touchTarget: 44,
} as const;

export const typography = {
  family: {
    regular: 'Inter_400Regular',
    semibold: 'Inter_600SemiBold',
  },
  size: {
    body: 16,
    title: 28,
    hero: 36,
    label: 14,
  },
} as const;
