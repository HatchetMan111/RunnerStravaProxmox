export interface ActivitySummary {
  id: string
  sport_type: string
  name: string
  notes: string
  description: string
  visibility: string
  start_time: string | null
  timezone_name: string | null
  distance_m: number
  moving_time_s: number
  elapsed_time_s: number
  avg_speed_ms: number | null
  max_speed_ms: number | null
  elevation_gain_m: number | null
  elevation_loss_m: number | null
  avg_hr: number | null
  max_hr: number | null
  avg_cadence: number | null
  avg_power: number | null
  device_name: string | null
  source_file_type: string | null
  original_filename: string | null
  tags: string[]
  has_stream: boolean
  created_at: string
}

export interface ActivityDetailData extends ActivitySummary {
  stream: Record<string, Array<number | null>> | null
  splits: SplitRow[]
}

export interface SplitRow {
  index: number
  kind: string
  start_offset_s: number
  duration_s: number
  distance_m: number
  avg_speed_ms: number | null
  avg_hr: number | null
  elevation_gain_m: number | null
}

export interface StatsOverview {
  totals: { count: number; distance_m: number; moving_time_s: number; elevation_gain_m: number }
  by_sport: Record<string, { count: number; distance_m: number; moving_time_s: number }>
  weekly_last_12: Array<{ week_start: string; count: number; distance_m: number; moving_time_s: number }>
  monthly_last_12: Array<{ month: string; count: number; distance_m: number; moving_time_s: number }>
  records: Record<string, { duration_s: number; activity_id: string; name: string; start_time: string | null } | null>
}

export const SPORT_TYPES = [
  'running',
  'cycling',
  'walking',
  'hiking',
  'swimming',
  'treadmill',
  'other',
]

export const SPORT_LABELS: Record<string, string> = {
  running: 'Laufen',
  cycling: 'Radfahren',
  walking: 'Gehen',
  hiking: 'Wandern',
  swimming: 'Schwimmen',
  treadmill: 'Laufband',
  other: 'Sonstiges',
}
