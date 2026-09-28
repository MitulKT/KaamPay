// Design tokens. Status colours are fixed across cards, grid cells, chips and charts.
export const C = {
  primary: '#3730A3',
  primaryLight: '#EEF2FF',
  bg: '#F8FAFC',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  placeholder: '#94A3B8',
  disabled: '#CBD5E1',
  border: '#E2E8F0',
  green: '#16A34A',
  red: '#DC2626',
  amber: '#F59E0B',
  white: '#FFFFFF',
};

export const STATUS_COLORS: Record<string, string> = {
  NONE: '#CBD5E1',
  ASSIGNED: '#3B82F6',
  STARTED: '#F59E0B',
  DONE: '#F97316',
  CHECKED: '#8B5CF6',
  APPROVED: '#16A34A',
  PAID: '#0F766E',
  REJECTED: '#DC2626',
  CANCELLED: '#94A3B8',
};

export const R = { card: 12, chip: 999 };
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Worker screens use bigger type and touch targets than staff screens.
export const FONT = {
  worker: { body: 20, big: 32, huge: 44, label: 16 },
  staff: { body: 16, big: 24, huge: 32, label: 13 },
};
export const TOUCH = { worker: 64, staff: 48, min: 44 };
