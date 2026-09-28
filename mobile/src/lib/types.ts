export type Role = 'WORKER' | 'SUPERVISOR' | 'ADMIN';
export type JobStatus = 'ASSIGNED' | 'STARTED' | 'DONE' | 'CHECKED' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type Lang = 'hi' | 'gu' | 'en';

export interface User {
  id: string;
  company_id: string;
  name: string;
  name_local?: string;
  mobile: string;
  roles: Role[];
  preferred_language: Lang;
  photo_url?: string | null;
  is_active: boolean;
  pending_mobile?: boolean;
  profile?: WorkerProfile | null;
  summary?: WorkerSummary;
}

export interface WorkerProfile {
  worker_code: string;
  payment_mode: 'CASH' | 'UPI' | 'BANK';
  upi_id?: string;
  bank_name?: string;
  ifsc?: string;
  account_last4?: string;
  skill_work_type_ids: string[];
}

export interface CompanySettings {
  payout_cycle: 'WEEKLY' | 'MONTHLY';
  week_start_day: number;
  supervisor_check_required: boolean;
  photo_required_on_done: boolean;
  allow_worker_self_claim: boolean;
  show_amount_to_worker: boolean;
  use_started_step: boolean;
  max_advance_recovery_percent: number;
  jobs_per_day_warning: number;
  advance_alert_above: number;
  rounding: 'NONE' | 'NEAREST_1';
  languages: Lang[];
}

export interface Company {
  id: string;
  name: string;
  gstin?: string;
  address?: string;
  logo_url?: string | null;
  settings: CompanySettings;
}

export interface WorkType {
  id: string;
  code: string;
  name_en: string;
  name_hi?: string;
  name_gu?: string;
  icon?: string;
  sequence_no: number;
  is_active: boolean;
}

export interface Colour {
  code: string;
  name?: string;
  qty: number;
}

export interface Lot {
  id: string;
  lot_no: string;
  item_name?: string;
  style_id?: string | null;
  colours: Colour[];
  total_qty: number;
  start_date?: string | null;
  target_date?: string | null;
  status: 'OPEN' | 'IN_PRODUCTION' | 'CLOSED';
  remarks?: string;
  progress?: { total_cells: number; assigned_cells: number; done_cells: number; percent_done: number };
  missing_rates?: number;
}

export interface Job {
  id: string;
  job_no: string;
  lot_id: string;
  lot_no: string;
  item_name?: string;
  work_type_id: string;
  work_type_code: string;
  work_type_name_en?: string;
  work_type_name_hi?: string;
  work_type_name_gu?: string;
  work_type_icon?: string;
  worker_id: string;
  worker_name: string;
  worker_name_local?: string;
  worker_photo?: string | null;
  colour_codes: string[];
  split_pieces?: number | null;
  pieces: number;
  rate_snapshot?: number;
  amount?: number;
  status: JobStatus;
  assigned_at: string;
  done_at?: string | null;
  checked_at?: string | null;
  approved_at?: string | null;
  done_photo_url?: string | null;
  done_note?: string;
  done_on_behalf?: boolean;
  rejected_reason?: string | null;
  rejected_note?: string | null;
  reject_count?: number;
  checked_by?: string | null;
  source?: string;
  manual_override?: boolean;
}

export interface WorkerSummary {
  receivable: number;
  earned_total: number;
  pending_approval: number;
  advance_total: number;
  advance_open: number;
  deductions_total: number;
  paid_total: number;
  earned_this_month: number;
  open_jobs: number;
}

export interface CycleLine {
  worker_id: string;
  worker_name: string;
  worker_name_local?: string;
  worker_code?: string;
  payment_mode?: string;
  upi_id?: string;
  gross: number;
  advance_recovery: number;
  deductions: number;
  net_payable: number;
  paid_amount: number;
  balance: number;
  job_ids: string[];
  jobs_count: number;
  excluded: boolean;
}

export interface Cycle {
  id: string;
  cycle_no: string;
  period_type: string;
  from_date: string;
  to_date: string;
  status: 'DRAFT' | 'LOCKED' | 'PAID';
  lines: CycleLine[];
  totals: { gross: number; advance_recovery: number; deductions: number; net_payable: number; paid_amount: number; balance: number; workers: number };
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  at: string;
}
