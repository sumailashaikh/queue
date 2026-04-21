const toMinutes = (timeStr: string): number => {
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
};

export async function checkProviderAvailabilityAt(
  adminSupabase: any,
  providerId: string,
  businessId: string,
  businessTimezone: string = "UTC",
  at: Date = new Date(),
): Promise<{ available: boolean; reason?: string }> {
  const dateStr = at.toLocaleDateString("en-CA", { timeZone: businessTimezone });
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const nowLocal = at.toLocaleTimeString("en-GB", {
    timeZone: businessTimezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const nowMins = toMinutes(nowLocal);

  const [{ data: weekly }, { data: dayOffs }, { data: blockTimes }, { data: leaves }] = await Promise.all([
    adminSupabase
      .from("provider_availability")
      .select("day_of_week, start_time, end_time, is_available")
      .eq("provider_id", providerId)
      .eq("day_of_week", dayOfWeek)
      .limit(1)
      .maybeSingle(),
    adminSupabase
      .from("provider_day_offs")
      .select("day_off_type, start_time, end_time")
      .eq("provider_id", providerId)
      .eq("business_id", businessId)
      .eq("day_off_date", dateStr),
    adminSupabase
      .from("provider_block_times")
      .select("start_time, end_time")
      .eq("provider_id", providerId)
      .eq("business_id", businessId)
      .eq("block_date", dateStr),
    adminSupabase
      .from("provider_leaves")
      .select("leave_kind, start_time, end_time, status")
      .eq("provider_id", providerId)
      .eq("business_id", businessId)
      .lte("start_date", dateStr)
      .gte("end_date", dateStr),
  ]);

  if (!weekly || weekly.is_available === false) {
    return { available: false, reason: "off_day" };
  }
  const shiftStart = toMinutes(String(weekly.start_time || "00:00").slice(0, 5));
  const shiftEnd = toMinutes(String(weekly.end_time || "23:59").slice(0, 5));
  if (nowMins < shiftStart || nowMins >= shiftEnd) {
    return { available: false, reason: "outside_working_hours" };
  }

  for (const d of dayOffs || []) {
    const type = String(d.day_off_type || "full_day").toLowerCase();
    if (type === "full_day") return { available: false, reason: "day_off" };
    const s = toMinutes(String(d.start_time || "00:00").slice(0, 5));
    const e = toMinutes(String(d.end_time || "23:59").slice(0, 5));
    if (nowMins >= s && nowMins < e) return { available: false, reason: "day_off_partial" };
  }

  for (const b of blockTimes || []) {
    const s = toMinutes(String(b.start_time || "00:00").slice(0, 5));
    const e = toMinutes(String(b.end_time || "23:59").slice(0, 5));
    if (nowMins >= s && nowMins < e) return { available: false, reason: "blocked_time" };
  }

  for (const l of leaves || []) {
    const status = String(l.status || "PENDING").toUpperCase();
    if (status === "REJECTED") continue;
    const kind = String(l.leave_kind || "FULL_DAY").toUpperCase();
    if (kind === "FULL_DAY") return { available: false, reason: "leave" };
    const s = toMinutes(String(l.start_time || "00:00").slice(0, 5));
    const e = toMinutes(String(l.end_time || "23:59").slice(0, 5));
    if (nowMins >= s && nowMins < e) return { available: false, reason: "leave_partial" };
  }

  return { available: true };
}

