import { Request, Response } from "express";
import { getLocalDateString } from "../utils/timeUtils";

const getEmployeeProviderContext = async (supabase: any, userId: string) => {
  const providerRes = await supabase
    .from("service_providers")
    .select("id, business_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return providerRes.data || null;
};

const getBusinessToday = async (supabase: any, businessId?: string | null) => {
  if (!businessId) return new Date().toISOString().split("T")[0];
  const { data: biz } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  return getLocalDateString(biz?.timezone || "UTC");
};

export const getEmployeeTasks = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    if (!userId) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const provider = await getEmployeeProviderContext(supabase, userId);
    if (!provider?.id) return res.status(200).json({ status: "success", data: [] });
    const todayStr = await getBusinessToday(supabase, provider.business_id);

    const { data, error } = await supabase
      .from("queue_entry_services")
      .select(
        `
        id,
        task_status,
        started_at,
        completed_at,
        services (id, name),
        queue_entries!inner (
          id,
          customer_name,
          entry_date,
          status,
          ticket_number
        )
      `,
      )
      .eq("assigned_provider_id", provider.id)
      .eq("queue_entries.entry_date", todayStr)
      .in("task_status", ["pending", "in_progress"]);

    if (error) throw error;
    return res.status(200).json({ status: "success", data: data || [] });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const getEmployeeAppointmentsToday = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    if (!userId) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const provider = await getEmployeeProviderContext(supabase, userId);
    if (!provider?.id) return res.status(200).json({ status: "success", data: [] });

    const todayStr = await getBusinessToday(supabase, provider.business_id);
    const startOfDayIso = `${todayStr}T00:00:00.000Z`;
    const endOfDayIso = `${todayStr}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id,
        start_time,
        status,
        guest_name,
        profiles:user_id (full_name),
        appointment_services (
          services (id, name)
        )
      `,
      )
      .eq("assigned_provider_id", provider.id)
      .gte("start_time", startOfDayIso)
      .lte("start_time", endOfDayIso)
      .order("start_time", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ status: "success", data: data || [] });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const getEmployeeAppointmentsUpcoming = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    if (!userId) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const provider = await getEmployeeProviderContext(supabase, userId);
    if (!provider?.id) return res.status(200).json({ status: "success", data: [] });

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id,
        start_time,
        status,
        guest_name,
        profiles:user_id (full_name),
        appointment_services (
          services (id, name)
        )
      `,
      )
      .eq("assigned_provider_id", provider.id)
      .gt("start_time", nowIso)
      .order("start_time", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ status: "success", data: data || [] });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const getEmployeeTodaySummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    if (!userId) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const provider = await getEmployeeProviderContext(supabase, userId);
    if (!provider?.id) {
      return res.status(200).json({
        status: "success",
        data: { tasks_completed_today: 0, customers_served_today: 0 },
      });
    }

    const todayStr = await getBusinessToday(supabase, provider.business_id);
    const startOfDayIso = `${todayStr}T00:00:00.000Z`;
    const endOfDayIso = `${todayStr}T23:59:59.999Z`;

    const { data: doneTasks, error } = await supabase
      .from("queue_entry_services")
      .select("id, queue_entry_id, completed_at")
      .eq("assigned_provider_id", provider.id)
      .eq("task_status", "done")
      .gte("completed_at", startOfDayIso)
      .lte("completed_at", endOfDayIso);
    if (error) throw error;

    const completedCount = (doneTasks || []).length;
    const customersServed = new Set(
      (doneTasks || []).map((t: any) => String(t.queue_entry_id)).filter(Boolean),
    ).size;

    return res.status(200).json({
      status: "success",
      data: {
        tasks_completed_today: completedCount,
        customers_served_today: customersServed,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

