export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysFromMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysFromMonday);
  return result;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const start = new Intl.DateTimeFormat('en-AU', { day: 'numeric' }).format(
    monday,
  );
  const end = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(sunday);
  return `${start} – ${end}`;
}

export function formatDay(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
  }).format(date);
  const dayAndMonth = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(date);
  return `${weekday} - ${dayAndMonth}`;
}

export function formatSessionDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
