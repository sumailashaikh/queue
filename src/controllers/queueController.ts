import { Request, Response } from "express";
import { supabase } from "../config/supabaseClient";
import { notificationService } from "../services/notificationService";
import { isBusinessOpen, getLocalDateString } from "../utils/timeUtils";
import { recomputeProviderDelays } from "../utils/delayLogic";
import { isBlockingApprovedLeave } from "../utils/leaveStatus";
import { checkProviderAvailabilityAt } from "../utils/providerAvailability";

const queueWaMessage = (
  lang: string,
  kind: "join" | "delay" | "next" | "ready",
  businessName: string,
) => {
  const l = String(lang || "en").toLowerCase();
  if (l === "hi") {
    if (kind === "join") return `${businessName} की कतार में जुड़ने के लिए धन्यवाद। आपकी बारी नजदीक आने पर हम आपको सूचित करेंगे।`;
    if (kind === "delay") return `हम इस समय व्यस्त हैं और पूर्ण क्षमता पर काम कर रहे हैं। कृपया धैर्य रखें।`;
    if (kind === "next") return `अब आपकी बारी है ${businessName} में। कृपया काउंटर पर आएं।`;
    return `आपकी बारी ${businessName} में जल्द आने वाली है। कृपया पास में रहें।`;
  }
  if (l === "ar") {
    if (kind === "join") return `شكرًا لانضمامك إلى الطابور في ${businessName}. سنقوم بإشعارك عندما يقترب دورك.`;
    if (kind === "delay") return `نحن نخدم الضيوف حاليًا ونعمل بكامل الطاقة. شكرًا لصبرك.`;
    if (kind === "next") return `حان دورك الآن في ${businessName}. يرجى التوجه إلى المنضدة.`;
    return `دورك في ${businessName} سيأتي قريبًا. يرجى البقاء بالقرب.`;
  }
  if (l === "es") {
    if (kind === "join") return `Gracias por unirte a la cola en ${businessName}. Te avisaremos cuando se acerque tu turno.`;
    if (kind === "delay") return `Actualmente estamos atendiendo clientes y operando a plena capacidad. Gracias por tu paciencia.`;
    if (kind === "next") return `Tu turno es ahora en ${businessName}. Por favor acércate al mostrador.`;
    return `Tu turno en ${businessName} está por llegar. Por favor mantente cerca.`;
  }
  if (kind === "join") return `Thank you for joining the queue at ${businessName}. We’ll notify you as your turn approaches.`;
  if (kind === "delay") return `We’re currently serving guests and operating at full capacity. Thank you for your patience.`;
  if (kind === "next") return `Your turn is now at ${businessName}. Please proceed to the counter.`;
  return `Your turn at ${businessName} is coming up soon. Please stay nearby.`;
};

export const getAllQueues = async (req: Request, res: Response) => {
  try {
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const { data, error } = await supabase
      .from("queues")
      .select("*")
      .eq("status", "open");

    if (error) throw error;

    res.status(200).json({
      status: "success",
      message: "Queues retrieved successfully",
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const getMyTasks = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const { adminSupabase } = require("../config/supabaseClient");

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Find the provider record for this user (business_id for local “today” + filters)
    // Avoid single-row coercion here because older data can contain duplicate
    // provider rows linked to the same user_id.
    const providerRes = await supabase
      .from("service_providers")
      .select("id, business_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let provider = providerRes.data;
    const providerIds = new Set<string>();
    if (provider?.id) providerIds.add(String(provider.id));

    // Fallback by phone for newly invited employees not linked yet.
    if (!provider) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", userId)
        .maybeSingle();
      const normalizedPhone = (profile?.phone || "").replace(/[^\d+]/g, "");
      if (normalizedPhone) {
        const { data: providerByPhone } = await adminSupabase
          .from("service_providers")
          .select("id, user_id, business_id")
          .eq("phone", normalizedPhone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (providerByPhone) {
          if (!providerByPhone.user_id) {
            await adminSupabase
              .from("service_providers")
              .update({ user_id: userId })
              .eq("id", providerByPhone.id);
          }
          provider = {
            id: providerByPhone.id,
            business_id: providerByPhone.business_id,
          } as any;
          if (providerByPhone.id) providerIds.add(String(providerByPhone.id));
        }
      }
    }

    if (!provider) {
      // Fallback for accounts where provider linkage is missing:
      // return both direct entry-level assignment and per-service assignment
      // discovered by employee phone number.
      const fallbackSelect = `
            *,
            queue_entry_services (
                *,
                services (id, name)
            ),
            queues (
                id,
                name,
                business_id
            )
        `;
      const normalizeDigits = (v: any) => String(v || "").replace(/[^\d]/g, "");
      const { data: meProfile } = await adminSupabase
        .from("profiles")
        .select("phone")
        .eq("id", userId)
        .maybeSingle();
      const myPhoneDigits = normalizeDigits(meProfile?.phone);
      const todayStr = getLocalDateString("Asia/Kolkata");

      const fallbackMap = new Map<string, any>();
      const { data: directRows, error: directErr } = await adminSupabase
        .from("queue_entries")
        .select(fallbackSelect)
        .eq("assigned_to", userId)
        .eq("entry_date", todayStr)
        .in("status", ["pending", "serving", "waiting"])
        .order("position", { ascending: true });
      if (directErr) throw directErr;
      (directRows || []).forEach((row: any) => fallbackMap.set(String(row.id), row));

      if (myPhoneDigits) {
        const { data: phoneMatchedProviders } = await adminSupabase
          .from("service_providers")
          .select("id, phone")
          .not("phone", "is", null);
        const phoneProviderIds = (phoneMatchedProviders || [])
          .filter((row: any) => normalizeDigits(row?.phone) === myPhoneDigits)
          .map((row: any) => row?.id)
          .filter(Boolean);

        if (phoneProviderIds.length > 0) {
          const { data: directProviderRows, error: directProviderErr } = await adminSupabase
            .from("queue_entries")
            .select(fallbackSelect)
            .in("assigned_provider_id", phoneProviderIds)
            .eq("entry_date", todayStr)
            .in("status", ["pending", "serving", "waiting"])
            .order("position", { ascending: true });
          if (directProviderErr) throw directProviderErr;
          (directProviderRows || []).forEach((row: any) => fallbackMap.set(String(row.id), row));

          const { data: serviceTaskRows } = await adminSupabase
            .from("queue_entry_services")
            .select("queue_entry_id")
            .in("assigned_provider_id", phoneProviderIds);
          const entryIds = Array.from(
            new Set((serviceTaskRows || []).map((r: any) => String(r.queue_entry_id)).filter(Boolean)),
          );
          if (entryIds.length > 0) {
            const { data: serviceRows, error: serviceRowsErr } = await adminSupabase
              .from("queue_entries")
              .select(fallbackSelect)
              .in("id", entryIds)
              .eq("entry_date", todayStr)
              .in("status", ["pending", "serving", "waiting"])
              .order("position", { ascending: true });
            if (serviceRowsErr) throw serviceRowsErr;
            (serviceRows || []).forEach((row: any) => fallbackMap.set(String(row.id), row));
          }
        }
      }

      const fallbackRows = Array.from(fallbackMap.values()).sort(
        (a: any, b: any) => (a.position || 0) - (b.position || 0),
      );
      return res.status(200).json({ status: "success", data: fallbackRows });
    }

    // Include all provider rows linked to this employee user to avoid missing tasks
    // when legacy duplicate provider records exist.
    const { data: providerRows } = await adminSupabase
      .from("service_providers")
      .select("id")
      .eq("user_id", userId);
    (providerRows || []).forEach((row: any) => {
      if (row?.id) providerIds.add(String(row.id));
    });
    if (provider?.id) providerIds.add(String(provider.id));

    // Additional fallback: include provider rows matched by employee phone.
    // This handles legacy/invited staff records where user_id is not yet linked
    // to the exact provider row used during owner assignment.
    const normalizePhone = (v: any) => String(v || "").replace(/[^\d]/g, "");
    const { data: meProfile } = await adminSupabase
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    const myPhone = normalizePhone(meProfile?.phone);
    if (myPhone && (provider as any)?.business_id) {
      const { data: sameBizProviders } = await adminSupabase
        .from("service_providers")
        .select("id, phone")
        .eq("business_id", (provider as any).business_id);
      (sameBizProviders || []).forEach((row: any) => {
        if (normalizePhone(row?.phone) === myPhone && row?.id) {
          providerIds.add(String(row.id));
        }
      });
    }

    const providerIdList = Array.from(providerIds);
    const { data: bizRow } = await adminSupabase
      .from("businesses")
      .select("timezone")
      .eq("id", (provider as any).business_id)
      .maybeSingle();
    const todayStr = getLocalDateString(bizRow?.timezone || "Asia/Kolkata");

    if (!(provider as any).business_id && provider.id) {
      const { data: pRow } = await adminSupabase
        .from("service_providers")
        .select("business_id")
        .eq("id", provider.id)
        .maybeSingle();
      if (pRow?.business_id) (provider as any).business_id = pRow.business_id;
    }

    // 2. Fetch tasks via two safe queries (avoid PostgREST .or raw parser issues with UUIDs)
    const baseSelect = `
            *,
            queue_entry_services (
                *,
                services (id, name)
            ),
            queues (
                id,
                name,
                business_id
            )
        `;

    const [primaryAssigned, entryProviderAssigned, serviceAssigned] = await Promise.all([
      adminSupabase
        .from("queue_entries")
        .select(baseSelect)
        .eq("assigned_to", userId)
        .eq("entry_date", todayStr)
        .in("status", ["pending", "serving", "waiting"]),
      adminSupabase
        .from("queue_entries")
        .select(baseSelect)
        .in("assigned_provider_id", providerIdList)
        .eq("entry_date", todayStr)
        .in("status", ["pending", "serving", "waiting"]),
      adminSupabase
        .from("queue_entries")
        .select(baseSelect)
        .in("queue_entry_services.assigned_provider_id", providerIdList)
        .eq("entry_date", todayStr)
        .in("status", ["pending", "serving", "waiting"]),
    ]);

    if (primaryAssigned.error) throw primaryAssigned.error;
    if (entryProviderAssigned.error) throw entryProviderAssigned.error;
    if (serviceAssigned.error) throw serviceAssigned.error;

    const mergedMap = new Map<string, any>();
    (primaryAssigned.data || []).forEach((row: any) =>
      mergedMap.set(row.id, row),
    );
    (entryProviderAssigned.data || []).forEach((row: any) =>
      mergedMap.set(row.id, row),
    );
    (serviceAssigned.data || []).forEach((row: any) =>
      mergedMap.set(row.id, row),
    );

    // Fallback path for environments where nested ".in(queue_entry_services.assigned_provider_id, ...)"
    // can under-return rows. Fetch task rows first, then fetch parent queue entries by ids.
    if (
      (serviceAssigned.data || []).length === 0 &&
      providerIdList.length > 0
    ) {
      const { data: serviceTaskRows, error: serviceTaskErr } =
        await adminSupabase
          .from("queue_entry_services")
          .select(
            `
                    queue_entry_id,
                    task_status,
                    queue_entries!inner (
                        id,
                        entry_date,
                        status
                    )
                `,
          )
          .in("assigned_provider_id", providerIdList);

      if (!serviceTaskErr) {
        const eligibleEntryIds = Array.from(
          new Set(
            (serviceTaskRows || [])
              .filter(
                (r: any) =>
                  ["pending", "waiting", "serving"].includes(
                    String(r?.queue_entries?.status || ""),
                  ) && String(r?.queue_entries?.entry_date || "") === todayStr,
              )
              .map((r: any) => String(r.queue_entry_id))
              .filter(Boolean),
          ),
        );

        if (eligibleEntryIds.length > 0) {
          const { data: fallbackEntries, error: fallbackErr } =
            await adminSupabase
              .from("queue_entries")
              .select(baseSelect)
              .in("id", eligibleEntryIds)
              .eq("entry_date", todayStr)
              .in("status", ["pending", "serving", "waiting"]);
          if (!fallbackErr) {
            (fallbackEntries || []).forEach((row: any) =>
              mergedMap.set(row.id, row),
            );
          }
        }
      }
    }

    const providerIdSet = new Set(providerIdList);
    const isTaskOpen = (s: any) => {
      const st = String(s?.task_status || "").toLowerCase();
      return st !== "done" && st !== "completed" && st !== "cancelled" && st !== "skipped";
    };
    const hasOpenWorkForProvider = (entry: any) => {
      const services = entry.queue_entry_services || [];
      const mine = services.filter((s: any) =>
        providerIdSet.has(String(s.assigned_provider_id || "")),
      );
      if (mine.length > 0) {
        // Employee "My Work" should show only actionable/open tasks.
        return mine.some(isTaskOpen);
      }
      if (entry.assigned_to === userId) {
        if (services.length === 0) {
          return (
            entry.status === "waiting" ||
            entry.status === "serving"
          );
        }
        if (["waiting", "pending", "serving"].includes(String(entry?.status || "").toLowerCase())) {
          return services.some(isTaskOpen);
        }
        return services.some(isTaskOpen);
      }
      return false;
    };

    const data = Array.from(mergedMap.values())
      .filter(hasOpenWorkForProvider)
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

    // Normalize customer label for appointment-backed entries.
    // Older data may have queue_entries.customer_name captured from a wrong profile.
    const appointmentIds = Array.from(
      new Set(
        (data || [])
          .map((row: any) => row?.appointment_id)
          .filter((v: any) => !!v)
          .map((v: any) => String(v)),
      ),
    );
    if (appointmentIds.length > 0) {
      const { data: apptRows } = await adminSupabase
        .from("appointments")
        .select("id, guest_name, profiles:user_id(full_name)")
        .in("id", appointmentIds);
      const apptMap = new Map<string, any>();
      (apptRows || []).forEach((a: any) => apptMap.set(String(a.id), a));
      data.forEach((row: any) => {
        const appt = apptMap.get(String(row?.appointment_id || ""));
        if (!appt) return;
        const profileObj = Array.isArray(appt.profiles) ? appt.profiles[0] : appt.profiles;
        const displayName =
          String(appt?.guest_name || "").trim() ||
          String(profileObj?.full_name || "").trim() ||
          String(row?.customer_name || "").trim();
        if (displayName) row.customer_name = displayName;
      });
    }

    // Temporary targeted tracing for live debugging of a reported missing entry.
    const debugEntryId = "d34127c5-fbe4-4226-8b2d-a3778ae83074";
    const debugBefore = mergedMap.get(debugEntryId);
    const debugAfter = data.find((row: any) => String(row?.id) === debugEntryId);
    if (debugBefore || debugAfter) {
      console.log("[getMyTasks:debug-entry]", {
        userId,
        providerIds: providerIdList,
        beforeFilter: debugBefore
          ? {
              id: debugBefore.id,
              status: debugBefore.status,
              assigned_to: debugBefore.assigned_to,
              assigned_provider_id: debugBefore.assigned_provider_id,
              queue_entry_services: (debugBefore.queue_entry_services || []).map((s: any) => ({
                id: s.id,
                assigned_provider_id: s.assigned_provider_id,
                task_status: s.task_status,
              })),
            }
          : null,
        visibleAfterFilter: !!debugAfter,
      });
    }

    res.status(200).json({
      status: "success",
      data: data || [],
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const createQueue = async (req: Request, res: Response) => {
  try {
    const { name, description, service_id, business_id } = req.body;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    // Basic validation
    if (!name) {
      return res.status(400).json({
        status: "error",
        message: "Queue name is required",
      });
    }

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Link to the correct business
    let targetBusinessId = business_id;

    if (!targetBusinessId) {
      // Fallback: Find the first business owned by this user
      console.log(
        `[createQueue] No business_id provided, looking for business for owner: ${userId}`,
      );
      const { data: businesses, error: businessError } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_id", userId);

      if (businessError || !businesses || businesses.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "No business found for this user. Create a business first.",
        });
      }
      targetBusinessId = businesses[0].id;
    } else {
      // Verify ownership of the provided business_id
      const { data: biz, error: bizError } = await supabase
        .from("businesses")
        .select("id")
        .eq("id", targetBusinessId)
        .eq("owner_id", userId)
        .single();

      if (bizError || !biz) {
        return res.status(403).json({
          status: "error",
          message: "Business not found or access denied",
        });
      }
    }

    console.log(
      `[createQueue] Using business: ${targetBusinessId}. Proceeding to create queue: ${name}`,
    );

    const { data, error } = await supabase
      .from("queues")
      .insert([
        {
          business_id: targetBusinessId,
          name,
          description,
          service_id,
          status: "open",
          current_wait_time_minutes: 0,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      status: "success",
      message: "Queue created successfully",
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

import fs from "fs";

const resolveDefaultServiceForBusiness = async (
  supabase: any,
  businessId: string,
  canCreateDefault: boolean,
  defaultDuration: number,
  defaultPrice: number,
) => {
  const { data: generalService } = await supabase
    .from("services")
    .select("id, name, duration_minutes, price")
    .eq("business_id", businessId)
    .ilike("name", "General Service")
    .limit(1)
    .maybeSingle();
  if (generalService?.id) return generalService;

  if (canCreateDefault) {
    const { data: createdDefault } = await supabase
      .from("services")
      .insert([
        {
          business_id: businessId,
          name: "General Service",
          duration_minutes: Math.max(5, Number(defaultDuration || 10)),
          price: Number(defaultPrice || 0),
          translations: {},
        },
      ])
      .select("id, name, duration_minutes, price")
      .maybeSingle();
    if (createdDefault?.id) return createdDefault;
  }

  const { data: firstService } = await supabase
    .from("services")
    .select("id, name, duration_minutes, price")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return firstService || null;
};

export const joinQueue = async (req: Request, res: Response) => {
  try {
    const {
      queue_id,
      customer_name,
      phone,
      service_ids,
      entry_source,
      appointment_id,
      provider_id,
    } = req.body;
    const user_id = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const { adminSupabase } = require("../config/supabaseClient");

    const logState = (msg: string) => {
      fs.appendFileSync(
        "join_debug.log",
        `[${new Date().toISOString()}] ${msg}\n`,
      );
    };

    logState(`Join attempt for Queue: ${queue_id} | Name: ${customer_name}`);

    if (!queue_id) {
      return res
        .status(400)
        .json({ status: "error", message: "Queue ID is required" });
    }

    if (!user_id && !customer_name && !appointment_id) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "User ID, Customer Name, or Appointment ID is required",
        });
    }

    // 0. Get Queue and Business info early
    const { data: queueInfo, error: queueInfoError } = await supabase
      .from("queues")
      .select("*, businesses(name, language, open_time, close_time, is_closed, timezone)")
      .eq("id", queue_id)
      .single();

    if (queueInfoError || !queueInfo)
      throw queueInfoError || new Error("Queue not found");

    const timezone = queueInfo.businesses?.timezone || "UTC";
    const todayStr = getLocalDateString(timezone);

    let appointmentCustomerUserId: string | null = null;
    // --- STRONG APP RULE: Appointment Validation ---
    if (appointment_id) {
      const { data: appt, error: apptError } = await supabase
        .from("appointments")
        .select("id, user_id, start_time, status, business_id")
        .eq("id", appointment_id)
        .single();

      if (apptError || !appt) {
        return res
          .status(404)
          .json({ status: "error", message: "Appointment not found" });
      }

      const apptDateStr = getLocalDateString(
        timezone,
        new Date(appt.start_time),
      );
      const now = new Date();
      const gracePeriodMins = 30;
      const isExpired =
        now >
        new Date(new Date(appt.start_time).getTime() + gracePeriodMins * 60000);

      if (apptDateStr !== todayStr) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Please book a new appointment. This appointment is not for today.",
          });
      }

      if (!["scheduled", "confirmed"].includes(appt.status)) {
        return res
          .status(400)
          .json({
            status: "error",
            message: `Please book a new appointment. This appointment status is ${appt.status}.`,
          });
      }

      if (isExpired) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Please book a new appointment. Your appointment time has passed the 30-minute grace period.",
          });
      }
      appointmentCustomerUserId = appt.user_id || null;
    }
    // ----------------------------------------------

    // Check Business Hours (Basic Open/Closed)
    if (queueInfo?.businesses) {
      const status = isBusinessOpen(queueInfo.businesses);
      if (!status.isOpen) {
        return res
          .status(400)
          .json({ status: "error", message: status.message });
      }
    }

    // 1. Calculate current Wait Time for Closing Time Protection
    const { data: entriesAhead } = await supabase
      .from("queue_entries")
      .select("status, total_duration_minutes, served_at, joined_at")
      .eq("queue_id", queue_id)
      .eq("entry_date", todayStr)
      .in("status", ["waiting", "serving"]);

    let currentWaitTimeTotal = 0;
    const nowMs = Date.now();
    entriesAhead?.forEach((e: any) => {
      const plannedDuration = Number(e.total_duration_minutes || 10);
      if (e.status === "serving") {
        // Count only the remaining time for currently serving guests.
        const startedAt = e.served_at || e.joined_at;
        const startedAtMs = startedAt ? new Date(startedAt).getTime() : nowMs;
        const elapsedMins = Math.max(
          0,
          Math.round((nowMs - startedAtMs) / 60000),
        );
        const remainingMins = Math.max(0, plannedDuration - elapsedMins);
        currentWaitTimeTotal += remainingMins;
        return;
      }
      currentWaitTimeTotal += plannedDuration;
    });

    // Fetch active providers count to divide wait time (Capacity)
    const { count: activeProviders } = await supabase
      .from("service_providers")
      .select("*", { count: "exact", head: true })
      .eq("business_id", queueInfo.business_id)
      .eq("is_active", true);

    const providerCount = Math.max(1, activeProviders || 1);
    const currentWaitTime = Math.round(currentWaitTimeTotal / providerCount);

    // Fetch selected services for duration
    let selectedServices: any[] = [];
    if (service_ids && service_ids.length > 0) {
      const { data: sData } = await supabase
        .from("services")
        .select("id, name, duration_minutes, price")
        .in("id", service_ids);
      selectedServices = sData || [];
    }

    if (!selectedServices.length) {
      const fallbackService = await resolveDefaultServiceForBusiness(
        supabase,
        queueInfo.business_id,
        !!user_id, // allow auto-create only for authenticated owner/admin flows
        queueInfo.businesses?.default_duration || 10,
        queueInfo.businesses?.default_price || 0,
      );
      if (!fallbackService?.id) {
        return res.status(400).json({
          status: "error",
          message:
            "No services are configured for this business. Please add at least one service first.",
        });
      }
      selectedServices = [fallbackService];
    }

    const serviceDuration = selectedServices.reduce(
      (acc: number, s: any) => acc + (s.duration_minutes || 0),
      0,
    );

    // 2. Closing Time Protection Logic
    if (queueInfo?.businesses) {
      logState(
        `Checking capacity: Wait=${currentWaitTime}, Service=${serviceDuration}, Providers=${providerCount}`,
      );
      logState(`Business Data: ${JSON.stringify(queueInfo.businesses)}`);

      const closingProtection =
        require("../utils/timeUtils").canCompleteBeforeClosing(
          queueInfo.businesses,
          currentWaitTime,
          serviceDuration,
          0,
        );

      if (!closingProtection.canJoin) {
        logState(`REJECTED: ${closingProtection.message}`);
        return res.status(400).json({
          status: "error",
          message:
            closingProtection.message ||
            `We’re fully booked for today. Please book for tomorrow.`,
        });
      }
      logState(`Capacity check PASSED.`);
    }

    // 3. Get next position
    const { data: maxPosData } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("queue_id", queue_id)
      .eq("entry_date", todayStr)
      .order("position", { ascending: false })
      .limit(1);

    const nextPosition =
      maxPosData && maxPosData.length > 0 ? maxPosData[0].position + 1 : 1;
    const ticket_number = `Q-${nextPosition}`;
    const status_token = crypto.randomUUID();
    console.log(
      `[joinQueue] Next position: ${nextPosition}, Ticket number: ${ticket_number}`,
    );

    const total_price = selectedServices.reduce(
      (acc: number, s: any) => acc + (Number(s.price) || 0),
      0,
    );
    const serviceNamesDisplay =
      selectedServices.map((s: any) => s.name).join(", ") || "General";
    console.log(
      `[joinQueue] Total price: ${total_price}, Service names display: ${serviceNamesDisplay}`,
    );

    // Resolve customer user_id:
    // - if this join is for an appointment, use appointment.user_id
    // - otherwise only keep authenticated user_id when role is customer
    // - fallback to phone-based profile match for public/walk-in flows
    let effectiveUserId: string | null = appointmentCustomerUserId;
    if (!effectiveUserId && user_id) {
      const { data: actorProfile } = await adminSupabase
        .from("profiles")
        .select("role")
        .eq("id", user_id)
        .maybeSingle();
      const actorRole = String(actorProfile?.role || "").toLowerCase();
      if (actorRole === "customer") {
        effectiveUserId = user_id;
      }
    }
    if (!effectiveUserId && phone) {
      const normalize = (v: any) => String(v || "").replace(/[^\d]/g, "");
      const phoneRaw = String(phone || "").trim();
      const phoneDigits = normalize(phoneRaw);
      const phoneCandidates = Array.from(
        new Set(
          [phoneRaw, phoneDigits, `+${phoneDigits}`].filter(
            (p) => !!p && String(p).length >= 8,
          ),
        ),
      );
      if (phoneCandidates.length > 0) {
        const { data: profilesByPhone } = await adminSupabase
          .from("profiles")
          .select("id, phone")
          .in("phone", phoneCandidates);
        const exact = (profilesByPhone || []).find(
          (p: any) => normalize(p?.phone) === phoneDigits,
        );
        if (exact?.id) effectiveUserId = String(exact.id);
      }
    }

    // Resolve employee user_id for entry-level assignment when provider is preselected.
    let assignedToUserId: string | null = null;
    if (provider_id) {
      const { data: providerRow } = await supabase
        .from("service_providers")
        .select("id, user_id, business_id, businesses(timezone)")
        .eq("id", provider_id)
        .maybeSingle();
      if (!providerRow?.id) {
        return res.status(400).json({ status: "error", message: "Selected employee is not valid." });
      }
      const availability = await checkProviderAvailabilityAt(
        require("../config/supabaseClient").adminSupabase,
        providerRow.id,
        providerRow.business_id,
        (providerRow as any)?.businesses?.timezone || "UTC",
        new Date(),
      );
      if (!availability.available) {
        return res.status(400).json({
          status: "error",
          message: "The selected employee is currently unavailable. Please choose another available employee.",
        });
      }
      assignedToUserId = providerRow?.user_id || null;
    }

    // 4. Atomic insert (queue entry + tasks) via SQL function.
    console.log(`[joinQueue] Inserting atomic queue entry + tasks.`);
    const tasksPayload =
      selectedServices.length > 0
        ? selectedServices.map((service: any) => ({
            service_id: service.id,
            assigned_provider_id: provider_id || null,
            price: service.price || 0,
            duration_minutes: service.duration_minutes || 0,
          }))
        : [];

    const { data, error } = await supabase.rpc(
      "create_queue_entry_with_tasks",
      {
        p_queue_id: queue_id,
        p_user_id: effectiveUserId,
        p_customer_name: customer_name || "Guest",
        p_phone: phone || null,
        p_service_name: serviceNamesDisplay,
        p_status: "waiting",
        p_position: nextPosition,
        p_ticket_number: ticket_number,
        p_status_token: status_token,
        p_entry_date: todayStr,
        p_total_price: total_price,
        p_total_duration_minutes: serviceDuration,
        p_entry_source: entry_source || "online",
        p_assigned_provider_id: provider_id || null,
        p_assigned_to: assignedToUserId,
        p_tasks: tasksPayload,
      },
    );
    if (error) throw error;

    // Send Notifications
    const isOnline = (entry_source || "online") === "online";
    const businessName = queueInfo?.businesses?.name || "the salon";
    const businessLang = String(queueInfo?.businesses?.language || "en");

    if (isOnline && phone) {
      // 1. Join Notification
      await notificationService.sendWhatsApp(
        phone,
        queueWaMessage(businessLang, "join", businessName),
      );

      // 2. High Demand Notification (if delay >= 15)
      if (currentWaitTime >= 15) {
        await notificationService.sendWhatsApp(
          phone,
          queueWaMessage(businessLang, "delay", businessName),
        );
      }

      // Update notified_join
      await supabase
        .from("queue_entries")
        .update({ notified_join: true })
        .eq("id", data.id);
    }

    res.status(201).json({
      status: "success",
      message: "Joined queue successfully",
      data: {
        ...data,
        token: status_token,
        position: nextPosition,
        wait_time: currentWaitTime,
        status_url: `${req.headers.origin || ""}/status?token=${status_token}`,
      },
    });
  } catch (error: any) {
    console.error("Join Queue Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const createWalkIn = async (req: Request, res: Response) => {
  const { customer_name } = req.body || {};
  if (!customer_name || !String(customer_name).trim()) {
    return res.status(400).json({
      status: "error",
      message: "Customer name is required for walk-in",
    });
  }

  req.body = {
    ...req.body,
    entry_source: "manual",
  };

  return joinQueue(req, res);
};

export const updateQueue = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, status, current_wait_time_minutes } = req.body;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // We need to ensure the queue belongs to a business owned by the user.
    // The RLS policy we will add: "Business owners can update queues for their business"
    // But let's verification here too.

    // Update directly. If RLS works, it will only update if user is owner.
    // However, checking existence first gives better error messages (404 vs 403).

    const { data, error } = await supabase
      .from("queues")
      .update({ name, description, status, current_wait_time_minutes })
      .eq("id", id)
      // Implicit check: join business to check owner? Supabase simple update relies on RLS.
      // Let's rely on RLS + the fact we will add a policy.
      .select()
      .single();

    if (error) throw error;

    // If no data returned, either it doesn't exist or RLS blocked it
    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Queue not found or you do not have permission to update it",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Queue updated successfully",
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const deleteQueue = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { error, count } = await supabase
      .from("queues")
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) throw error;

    if (count === 0) {
      return res.status(404).json({
        status: "error",
        message: "Queue not found or already deleted",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Queue deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const getMyQueues = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // Get user's first business to determine timezone
    const { data: userBiz } = await supabase
      .from("businesses")
      .select("timezone")
      .eq("owner_id", userId)
      .limit(1)
      .single();
    const timezone = userBiz?.timezone || "UTC";
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });
    console.log(`Fetching queues for user ${userId}, today is ${todayStr}`);

    // Get queues where the business owner is ME
    // We fetch the count of entries. Filtering on queue_entries columns in the main query
    // will filter out the parent 'queues' if no entries match.
    // To show empty queues, we'll fetch them all first.
    const { data, error } = await supabase
      .from("queues")
      .select(
        `
                *,
                businesses!inner (id, owner_id, name),
                services (*),
                queue_entries(count)
            `,
      )
      .eq("businesses.owner_id", userId)
      // Removed filters on queue_entries here to prevent hiding empty queues
      .order("created_at", { ascending: false });

    if (error) throw error;

    console.log(`[getMyQueues] User: ${userId} | Found ${data?.length} queues`);
    if (data && data.length > 0) {
      console.log(
        `[getMyQueues] Sample Business Owner: ${data[0].businesses.owner_id}`,
      );
    }

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const getBillingEntriesToday = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: ownerBusinesses, error: bizError } = await supabase
      .from("businesses")
      .select("id, timezone")
      .eq("owner_id", userId);
    if (bizError) throw bizError;

    const businessIds = (ownerBusinesses || []).map((b: any) => b.id);
    if (businessIds.length === 0) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const timezone = ownerBusinesses?.[0]?.timezone || "UTC";
    const todayStr = getLocalDateString(timezone);

    const { data: queues, error: queueErr } = await supabase
      .from("queues")
      .select("id, name, business_id")
      .in("business_id", businessIds);
    if (queueErr) throw queueErr;

    const queueIds = (queues || []).map((q: any) => q.id);
    if (queueIds.length === 0) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const queueNameMap = new Map<string, string>(
      (queues || []).map((q: any) => [String(q.id), String(q.name || "Queue")]),
    );

    const { data: entries, error: entryError } = await supabase
      .from("queue_entries")
      .select(
        `
          *,
          queue_entry_services (
            id,
            price,
            duration_minutes,
            assigned_provider_id,
            task_status,
            started_at,
            completed_at,
            estimated_end_at,
            actual_minutes,
            delay_minutes,
            services!service_id (id, name),
            service_providers!assigned_provider_id (name)
          )
        `,
      )
      .in("queue_id", queueIds)
      .eq("entry_date", todayStr)
      .in("status", ["waiting", "serving", "completed"])
      .or("payment_method.eq.unpaid,payment_method.is.null")
      .order("joined_at", { ascending: false });
    if (entryError) throw entryError;

    const data = (entries || []).map((entry: any) => ({
      ...entry,
      queue_name: queueNameMap.get(String(entry.queue_id)) || "Queue",
    }));

    return res.status(200).json({ status: "success", data });
  } catch (error: any) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to load billing entries",
    });
  }
};

export const getTodayQueue = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_id
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // Get current date in YYYY-MM-DD format
    // 0. Get queue business_id and timezone
    const { data: qData } = await supabase
      .from("queues")
      .select("business_id, businesses(timezone)")
      .eq("id", id)
      .single();

    if (!qData) {
      return res
        .status(404)
        .json({ status: "error", message: "Queue not found" });
    }

    const timezone = qData.businesses?.timezone || "UTC";
    const todayStr = getLocalDateString(timezone);

    if (qData) {
      const now = new Date();
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000).toISOString();
      // Start of today in IST
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // 1.5 Auto-Process No-Shows for Appointments (30-min grace)
      // Find today's appointments that are past due
      const { data: expiredAppts } = await supabase
        .from("appointments")
        .select(
          `
                    id, 
                    user_id, 
                    guest_name, 
                    guest_phone,
                    status,
                    start_time,
                    profiles:user_id (full_name, phone),
                    appointment_services (
                        price,
                        duration_minutes,
                        services!service_id (id, name)
                    )
                `,
        )
        .eq("business_id", qData.business_id)
        .in("status", ["scheduled", "confirmed"])
        .is("checked_in_at", null) // CRITICAL: Stop flipping back restored/checked-in guests
        .lt("start_time", thirtyMinsAgo)
        .gt("start_time", startOfToday.toISOString()); // Only today's scheduled

      if (expiredAppts && expiredAppts.length > 0) {
        for (const appt of expiredAppts) {
          const { data: existingEntry } = await supabase
            .from("queue_entries")
            .select("id, status")
            .eq("appointment_id", appt.id)
            .single();

          // CRITICAL FIX: Only auto-no-show if NO entry exists OR if entry is still just 'waiting'
          // AND NOT manually handled or restored.
          // If entry is 'serving', 'completed', or has been manually handled, SKIP auto-no-show.
          if (!existingEntry) {
            const total_duration =
              (appt as any).appointment_services?.reduce(
                (acc: number, s: any) => acc + (s.duration_minutes || 0),
                0,
              ) || 0;
            const total_price =
              (appt as any).appointment_services?.reduce(
                (acc: number, s: any) => acc + (Number(s.price) || 0),
                0,
              ) || 0;
            const serviceNames =
              (appt as any).appointment_services
                ?.map((s: any) => s.services?.name)
                .filter(Boolean)
                .join(", ") || "Appointment Service";

            // 1. Mark Appointment as No-Show
            await supabase
              .from("appointments")
              .update({ status: "no_show" })
              .eq("id", appt.id);

            // 2. Insert No-Show Queue Entry
            await supabase.from("queue_entries").insert([
              {
                queue_id: id,
                appointment_id: appt.id,
                user_id: appt.user_id,
                customer_name:
                  (appt as any).profiles?.full_name ||
                  (appt as any).guest_name ||
                  "Guest",
                phone:
                  (appt as any).profiles?.phone ||
                  (appt as any).guest_phone ||
                  null,
                service_name: serviceNames,
                status: "no_show",
                entry_date: todayStr,
                total_price,
                total_duration_minutes: total_duration,
                position: 0,
                ticket_number: "A-NS",
              },
            ]);
          } else if (existingEntry.status === "waiting") {
            // If it's still waiting and past due, mark both as no-show
            await supabase
              .from("appointments")
              .update({ status: "no_show" })
              .eq("id", appt.id);
            await supabase
              .from("queue_entries")
              .update({ status: "no_show" })
              .eq("id", existingEntry.id);
          }
          // Else: If status is 'serving', 'completed', 'no_show' (already), or 'restored' (waiting but handled), we don't flip it.
        }
      }
    }

    // 1.6 Auto-Process Skipped Entries (7 minute rule)
    // If status is 'serving' (called) but served_at + 7m < now, set to 'skipped'
    // This only applies to entries where NO work has started (service_started_at is null)
    const sevenMinsAgo = new Date(Date.now() - 7 * 60000).toISOString();
    await supabase
      .from("queue_entries")
      .update({ status: "skipped" })
      .eq("queue_id", id)
      .eq("status", "serving")
      .is("service_started_at", null)
      .lt("served_at", sevenMinsAgo);

    const { data, error } = await supabase
      .from("queue_entries")
      .select(
        `
                *,
                profiles:user_id (ui_language),
                appointments ( id, start_time, checked_in_at ),
                service_providers (id, name),
                queue_entry_services (
                    id,
                    service_id,
                    price,
                    duration_minutes,
                    task_status,
                    assigned_provider_id,
                    started_at,
                    completed_at,
                    estimated_end_at,
                    actual_minutes,
                    delay_minutes,
                    services!service_id (id, name),
                    service_providers!assigned_provider_id (id, name)
                )
            `,
      )
      .eq("queue_id", id)
      .eq("entry_date", todayStr)
      .or(
        "status.in.(waiting,serving,no_show),and(status.eq.completed,or(payment_method.eq.unpaid,payment_method.is.null))",
      )
      .order("position", { ascending: true });

    if (error) throw error;

    // Post-process to compute entry-level delay and estimated_end_at
    const enhancedData = (data || []).map((entry: any) => {
      let totalDelay = 0;
      let maxEstEnd: Date | null = null;
      const normalizedServices = (entry.queue_entry_services || []).map((s: any) => {
        const rawStatus = String(s?.task_status || "").toLowerCase();
        // Defensive normalization: if DB lags task_status but timestamps are present,
        // infer the effective status so UI does not regress after Start/Done.
        if (!["done", "completed", "cancelled", "skipped", "in_progress", "pending", "waiting"].includes(rawStatus)) {
          if (s?.completed_at) return { ...s, task_status: "done" };
          if (s?.started_at && !s?.completed_at) return { ...s, task_status: "in_progress" };
          return { ...s, task_status: "pending" };
        }
        if ((rawStatus === "pending" || rawStatus === "waiting") && s?.started_at && !s?.completed_at) {
          return { ...s, task_status: "in_progress" };
        }
        if ((rawStatus === "in_progress" || rawStatus === "pending" || rawStatus === "waiting") && s?.completed_at) {
          return { ...s, task_status: "done" };
        }
        return s;
      });

      normalizedServices.forEach((s: any) => {
        totalDelay += s.delay_minutes || 0;

        // Track the latest estimated finish time
        if (s.estimated_end_at) {
          const est = new Date(s.estimated_end_at);
          if (!maxEstEnd || est > maxEstEnd) maxEstEnd = est;
        }
        // If a task is completed, its completion time is also a reference for the latest activity
        if (s.completed_at) {
          const comp = new Date(s.completed_at);
          if (!maxEstEnd || comp > maxEstEnd) maxEstEnd = comp;
        }
      });

      const hasInProgress = normalizedServices.some(
        (s: any) => String(s?.task_status || "").toLowerCase() === "in_progress",
      );
      const hasOpen = normalizedServices.some((s: any) =>
        !["done", "completed", "cancelled", "skipped"].includes(
          String(s?.task_status || "").toLowerCase(),
        ),
      );
      const normalizedEntryStatus = hasInProgress
        ? "serving"
        : hasOpen
          ? (entry.status || "waiting")
          : entry.status;

      return {
        ...entry,
        status: normalizedEntryStatus,
        queue_entry_services: normalizedServices,
        total_delay: totalDelay,
        estimated_end_at: maxEstEnd ? (maxEstEnd as Date).toISOString() : null,
      };
    });

    console.log(
      `Found ${enhancedData.length} active entries for queue ${id} today (${todayStr})`,
    );

    res.status(200).json({
      status: "success",
      data: enhancedData,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const updateQueueEntryStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // entry_id
    const { status } = req.body; // 'serving', 'completed', 'cancelled', 'no_show'
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    if (
      ![
        "waiting",
        "serving",
        "completed",
        "cancelled",
        "no_show",
        "skipped",
      ].includes(status)
    ) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid status" });
    }

    // --- SEQUENTIAL SERVING LOGIC & PROVIDER ASSIGNMENT ---
    const { data: currentEntryRows } = await supabase
      .from("queue_entries")
      .select(
        `
                *,
                queues!inner (
                    business_id, 
                    status,
                    businesses (timezone)
                ),
                queue_entry_services (service_id)
            `,
      )
      .eq("id", id)
      .limit(1);
    const currentEntry = Array.isArray(currentEntryRows)
      ? currentEntryRows[0]
      : currentEntryRows;

    const timezone = currentEntry?.queues?.businesses?.timezone || "UTC";
    const todayStr = getLocalDateString(timezone);

    // Backend-level Walk-in / Direct Serve Block
    if (status === "serving") {
      if (
        !currentEntry ||
        !currentEntry.ticket_number ||
        currentEntry.entry_date !== todayStr
      ) {
        return res.status(400).json({
          status: "error",
          message: "Customer must join the queue before being served.",
        });
      }
    }

    const updates: any = { status };

    if (status === "serving") {
      if (currentEntry) {
        // 1. Get current busy providers for this business today
        const { data: busyProviders } = await supabase
          .from("queue_entries")
          .select("assigned_provider_id")
          .eq("entry_date", currentEntry.entry_date)
          .eq("status", "serving")
          .not("assigned_provider_id", "is", null);

        const busyProviderIds =
          busyProviders?.map((p: any) => p.assigned_provider_id) || [];

        let eligibleProviderId = currentEntry.assigned_provider_id;

        // 2. Provider Assignment Logic
        if (!eligibleProviderId) {
          const requiredServiceIds =
            (currentEntry as any).queue_entry_services?.map(
              (s: any) => s.service_id,
            ) || [];

          // Find providers who are active and have ALL required services
          const { data: providers, error: provError } = await supabase
            .from("service_providers")
            .select(
              `
                            id,
                            name,
                            provider_services (service_id)
                        `,
            )
            .eq("business_id", (currentEntry as any).queues.business_id)
            .eq("is_active", true);

          if (provError) {
            console.error(
              "[queueController] Provider lookup error:",
              provError,
            );
            throw provError;
          }

          // Filtering: Supports ALL selected services AND is NOT busy
          const availableProvider = providers?.find((p: any) => {
            const providerServiceIds =
              p.provider_services?.map((ps: any) => ps.service_id) || [];
            const supportsAll = requiredServiceIds.every((rid: string) =>
              providerServiceIds.includes(rid),
            );
            const isNotBusy = !busyProviderIds.includes(p.id);
            return supportsAll && isNotBusy;
          });

          if (!availableProvider) {
            return res.status(400).json({
              status: "error",
              message:
                "No available expert found who supports all selected services. Please wait or assign manually.",
            });
          }
          eligibleProviderId = availableProvider.id;
        } else {
          // Check if the pre-assigned provider is busy
          if (busyProviderIds.includes(eligibleProviderId)) {
            return res.status(400).json({
              status: "error",
              message:
                "The selected expert is currently attending to another guest. Please choose an available expert.",
            });
          }
        }

        updates.assigned_provider_id = eligibleProviderId;

        // Also link to the user profile if the provider has one
        const { data: provProfileRows } = await supabase
          .from("service_providers")
          .select("user_id")
          .eq("id", eligibleProviderId)
          .limit(1);
        const provProfile = Array.isArray(provProfileRows)
          ? provProfileRows[0]
          : provProfileRows;

        if (provProfile?.user_id) {
          updates.assigned_to = provProfile.user_id;
        }

        // Update per-service assignment in queue_entry_services
        await supabase
          .from("queue_entry_services")
          .update({ assigned_provider_id: eligibleProviderId })
          .eq("queue_entry_id", id);
      }
    }

    if (status === "serving") {
      const now = new Date();
      const duration = Number(currentEntry?.total_duration_minutes || 0);
      const estEnd = new Date(now.getTime() + duration * 60000);
      updates.estimated_end_at = estEnd.toISOString();
      updates.served_at = now.toISOString();

      // Send "serving started" SMS with ETA
      const recipient =
        currentEntry?.phone ||
        (currentEntry?.user_id
          ? `User-${currentEntry.user_id}`
          : `Guest-${currentEntry?.customer_name}`);
      const etaStr = estEnd.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      });
      await notificationService.sendSMS(
        recipient,
        `Hello ${currentEntry?.customer_name}, your service has started! Estimated completion is ${etaStr}. Thank you!`,
      );
    }

    if (status === "completed") {
      const now = new Date();
      updates.completed_at = now.toISOString();
      updates.completed_by_id = userId;

      // Determine role
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .limit(1);
      const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
      updates.completed_by_role =
        profile?.role === "owner" || profile?.role === "admin"
          ? "OWNER"
          : "EMPLOYEE";

      // Fetch start and estimated end timestamps to calculate actual duration and delay
      const { data: timingRows } = await supabase
        .from("queue_entries")
        .select("service_started_at, estimated_end_at, total_duration_minutes")
        .eq("id", id)
        .limit(1);
      const timingData = Array.isArray(timingRows) ? timingRows[0] : timingRows;

      if (timingData?.service_started_at) {
        const start = new Date(timingData.service_started_at);
        const actualDuration = Math.round(
          (now.getTime() - start.getTime()) / 60000,
        );
        updates.actual_duration_minutes = actualDuration;

        if (timingData.estimated_end_at) {
          const estEnd = new Date(timingData.estimated_end_at);
          const delay = Math.max(
            0,
            Math.round((now.getTime() - estEnd.getTime()) / 60000),
          );
          updates.delay_minutes = delay;
        }
      }
    }

    console.log(
      `Updating queue entry ${id} with status ${status} by user ${userId}`,
    );

    // Update the entry
    // RLS "Business owners can update entries" will enforce permission
    const { data, error } = await supabase
      .from("queue_entries")
      .update(updates)
      .eq("id", id).select(`
                *,
                queues (name, business_id),
                service_providers (name)
            `);

    if (error) throw error;

    if (!data || data.length === 0) {
      console.error(
        `Update failed for entry ${id}. No data returned. Possible RLS bypass or missing entry.`,
      );
      return res.status(404).json({
        status: "error",
        message:
          "Entry not found or permission denied. Ensure you are the business owner.",
      });
    }

    const entry = data[0];

    // Send Notification
    // In real app, we'd fetch user's phone from profiles/auth or queue_entry
    // For now, mocking with "User-{id}"
    const recipient = entry.user_id
      ? `User-${entry.user_id}`
      : `Guest-${entry.customer_name}`;

    // Consolidate all queue notifications through the process helper
    if (currentEntry) {
      await processQueueNotifications(
        currentEntry.queue_id,
        currentEntry.entry_date,
        supabase,
      );
    }

    // --- SYNC STATUS TO APPOINTMENT ---
    if (entry.appointment_id) {
      let apptStatus = status;
      if (status === "waiting") apptStatus = "checked_in";
      if (status === "serving") apptStatus = "in_service";

      if (
        [
          "no_show",
          "cancelled",
          "completed",
          "checked_in",
          "in_service",
        ].includes(apptStatus)
      ) {
        await supabase
          .from("appointments")
          .update({
            status: apptStatus,
            completed_at:
              status === "completed" ? new Date().toISOString() : null,
          })
          .eq("id", entry.appointment_id);
      }
    }
    // -----------------------------------

    res.status(200).json({
      status: "success",
      message: "Status updated successfully",
      data: entry,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const noShowQueueEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Get current entry to check for notifications and provider lock
    const { data: currentEntry } = await supabase
      .from("queue_entries")
      .select("*")
      .eq("id", id)
      .single();

    if (!currentEntry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    // Enhanced Validation: Prevent no-show if checked in or in an invalid state
    if (currentEntry.checked_in_at) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Cannot mark no-show: Customer has already checked in.",
        });
    }

    // Allow marking 'serving' as no-show (e.g. if customer walks out after being called)
    if (["completed", "done", "cancelled"].includes(currentEntry.status)) {
      return res
        .status(400)
        .json({
          status: "error",
          message: `Cannot mark no-show: Entry is already ${currentEntry.status}.`,
        });
    }

    // 2. Update status and release provider lock
    const updates: any = {
      status: "no_show",
      assigned_provider_id: null,
    };

    const { data, error } = await supabase
      .from("queue_entries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // --- SYNC STATUS TO APPOINTMENT ---
    if (currentEntry.appointment_id) {
      await supabase
        .from("appointments")
        .update({ status: "no_show" })
        .eq("id", currentEntry.appointment_id);
    }
    // -----------------------------------

    // Release lock AND reset task status in junction table
    await supabase
      .from("queue_entry_services")
      .update({
        assigned_provider_id: null,
        task_status: "pending", // Reset tasks so "DONE" buttons disappear
      })
      .eq("queue_entry_id", id);

    // 3. Send Notification
    const recipient = currentEntry.phone;
    const isOnline = (currentEntry.entry_source || "online") === "online";
    if (isOnline && recipient) {
      const message =
        "We tried reaching you for your turn. If you still need service, please rejoin the queue.";
      await notificationService.sendWhatsApp(recipient, message);
      await supabase
        .from("queue_entries")
        .update({ notified_noshow: true })
        .eq("id", id);
    }

    // 4. Trigger position updates for the rest of the queue
    await processQueueNotifications(
      currentEntry.queue_id,
      currentEntry.entry_date,
      supabase,
    );

    res.status(200).json({
      status: "success",
      message: "Customer marked as no-show and expert released.",
      data,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

/**
 * Automated Queue Notifications
 * State 1: Join (Online Only) - Handled in joinQueue
 * State 2: Position <= 3 (Top 3) - Handled here
 * State 3: Position = 1 (Becoming Next) - Handled here
 * State 5: High Demand (Delay >= 15) - Handled in joinQueue
 */
export const processQueueNotifications = async (
  queueId: string,
  entryDate: string,
  supabase: any,
) => {
  try {
    // 1. Fetch current waiting entries for this queue
    // We join queues to get business name safely
    const { data: entries, error } = await supabase
      .from("queue_entries")
      .select(
        `
                id, ticket_number, phone, position, customer_name, entry_source, 
                notified_top3, notified_next,
                queues (
                    business_id,
                    businesses ( name, language )
                )
            `,
      )
      .eq("queue_id", queueId)
      .eq("entry_date", entryDate)
      .eq("status", "waiting")
      .order("position", { ascending: true });

    if (error || !entries) {
      console.error("[Notification Process] Fetch Error:", error);
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rank = i + 1; // Real-time rank in the waiting list
      const isOnline = (entry.entry_source || "online") === "online";

      // Extract business name from join
      const businessName =
        (entry.queues as any)?.businesses?.name || "the salon";
      const businessLang = String(
        (entry.queues as any)?.businesses?.language || "en",
      );

      if (!isOnline || !entry.phone) continue;

      // State 3: Position = 1 (Becoming Next)
      if (rank === 1 && !entry.notified_next) {
        await notificationService.sendWhatsApp(
          entry.phone,
          queueWaMessage(businessLang, "next", businessName),
        );
        await supabase
          .from("queue_entries")
          .update({ notified_next: true })
          .eq("id", entry.id);
      }
      // State 2: Position <= 3 (Top 3)
      else if (rank <= 3 && rank > 1 && !entry.notified_top3) {
        await notificationService.sendWhatsApp(
          entry.phone,
          queueWaMessage(businessLang, "ready", businessName),
        );
        await supabase
          .from("queue_entries")
          .update({ notified_top3: true })
          .eq("id", entry.id);
      }
    }
  } catch (err) {
    console.error("[Notification Process Error]:", err);
  }
};

export const resetQueueEntries = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_id
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // Get business timezone
    const { data: qData } = await supabase
      .from("queues")
      .select("businesses(timezone)")
      .eq("id", id)
      .single();
    const timezone = qData?.businesses?.timezone || "UTC";

    // Get current date string (Business Local Time)
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });

    console.log(
      `Resetting queue entries for queue ${id} on date ${todayStr} by user ${userId}`,
    );

    // Delete all entries for this queue today
    const { error } = await supabase
      .from("queue_entries")
      .delete()
      .eq("queue_id", id)
      .eq("entry_date", todayStr);

    if (error) throw error;

    res.status(200).json({
      status: "success",
      message: "Queue reset successfully for today",
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const getQueueStatus = async (req: Request, res: Response) => {
  try {
    const { token } = req.query; // status_token (UUID)
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!token) {
      return res
        .status(400)
        .json({ status: "error", message: "Token is required" });
    }

    const { data: entry, error: entryError } = await supabase
      .from("queue_entries")
      .select("*, queues(*, businesses(name, slug, phone, language, owner_id))")
      .eq("status_token", token)
      .single();

    if (entryError || !entry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    let businessLang =
      entry.ui_language || entry.queues?.businesses?.language || "en";
    if (!entry.ui_language && entry.queues?.businesses?.owner_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("ui_language")
        .eq("id", entry.queues.businesses.owner_id)
        .maybeSingle();
      if (profile?.ui_language) {
        businessLang = profile.ui_language;
      }
    }

    // 2. Get currently serving person for this queue
    const { data: currentServingEntries } = await supabase
      .from("queue_entries")
      .select("ticket_number, estimated_end_at, service_providers(name)")
      .eq("queue_id", entry.queue_id)
      .eq("status", "serving")
      .eq("entry_date", entry.entry_date)
      .order("served_at", { ascending: false })
      .limit(1);

    const currentServing =
      currentServingEntries && currentServingEntries.length > 0
        ? currentServingEntries[0]
        : null;

    // 3. Get Top 3 Context for "Queue Status" list
    const { data: topEntries } = await supabase
      .from("queue_entries")
      .select(
        `
                id, ticket_number, customer_name, status, position,
                service_providers(name),
                queue_entry_services(services(name))
            `,
      )
      .eq("queue_id", entry.queue_id)
      .eq("entry_date", entry.entry_date)
      .in("status", ["serving", "waiting"])
      .order("position", { ascending: true })
      .limit(3);

    const queueContext = (topEntries || []).map((e: any) => ({
      ticket: e.ticket_number,
      name: e.customer_name,
      status: e.status,
      specialist: e.service_providers?.name || "Waiting",
      service: e.queue_entry_services?.[0]?.services?.name || "General",
      is_user: e.id === entry.id,
    }));

    // 4. Calculate position ahead
    const { count } = await supabase
      .from("queue_entries")
      .select("*", { count: "exact", head: true })
      .eq("queue_id", entry.queue_id)
      .eq("status", "waiting")
      .eq("entry_date", entry.entry_date)
      .lt("position", entry.position);

    const positionAhead = count || 0;

    // 5. Calculate total wait time based on entries ahead (waiting)
    const { data: entriesAhead } = await supabase
      .from("queue_entries")
      .select("id, total_duration_minutes")
      .eq("queue_id", entry.queue_id)
      .eq("entry_date", entry.entry_date)
      .eq("status", "waiting")
      .lt("position", entry.position);

    let waitTime = 0;
    entriesAhead?.forEach((e: any) => {
      waitTime += e.total_duration_minutes || 10;
    });

    // 6. Add remaining time of the current serving entry
    if (currentServing?.estimated_end_at) {
      const now = new Date();
      const estEnd = new Date(currentServing.estimated_end_at);
      const remainingMinutes = Math.max(
        0,
        Math.round((estEnd.getTime() - now.getTime()) / 60000),
      );
      waitTime += remainingMinutes;
    }

    // 7. Fetch current user's services/specialist info for the main card
    const { data: myUserExtended } = await supabase
      .from("queue_entries")
      .select("*, service_providers(name, department, role)")
      .eq("id", entry.id)
      .single();

    const { data: myServices } = await supabase
      .from("queue_entry_services")
      .select("services(name, duration_minutes)")
      .eq("queue_entry_id", entry.id);

    const serviceNames =
      myServices?.map((s: any) => s.services?.name).filter(Boolean) || [];

    res.status(200).json({
      status: "success",
      data: {
        business_name: entry.queues?.businesses?.name,
        business_slug: entry.queues?.businesses?.slug,
        business_phone: entry.queues?.businesses?.phone,
        business_language: businessLang,
        display_token: entry.ticket_number,
        current_serving: currentServing?.ticket_number || "None",
        current_specialist: currentServing?.service_providers?.name || "Expert",
        position: positionAhead + 1,
        estimated_wait_time: waitTime,
        status: entry.status,
        guest_name: entry.customer_name,
        service_names: serviceNames,
        specialist: {
          name: myUserExtended?.service_providers?.name || "TBD",
          role:
            myUserExtended?.service_providers?.role ||
            myUserExtended?.service_providers?.department ||
            "Specialist",
        },
        queue_context: queueContext,
      },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const nextEntry = async (req: Request, res: Response) => {
  try {
    const { queue_id } = req.body;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    // Get business timezone
    const { data: qData } = await supabase
      .from("queues")
      .select("businesses(timezone)")
      .eq("id", queue_id)
      .single();
    const timezone = qData?.businesses?.timezone || "UTC";
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });

    if (!queue_id) {
      return res
        .status(400)
        .json({ status: "error", message: "Queue ID is required" });
    }

    // 1. Find next person in line
    const { data: next, error: nextError } = await supabase
      .from("queue_entries")
      .select(
        `
                *,
                queue_entry_services (service_id, assigned_provider_id)
            `,
      )
      .eq("queue_id", queue_id)
      .eq("status", "waiting")
      .eq("entry_date", todayStr)
      .order("position", { ascending: true })
      .limit(1)
      .single();

    if (nextError || !next) {
      return res
        .status(200)
        .json({ status: "success", message: "No more customers in queue." });
    }

    // 2. Respect explicit assignment first.
    // If no expert is assigned for this entry, require manual assignment.
    const taskAssignments = ((next as any).queue_entry_services || [])
      .map((s: any) => s?.assigned_provider_id)
      .filter(Boolean);
    const explicitProviderId =
      taskAssignments.length > 0 ? String(taskAssignments[0]) : null;
    if (!explicitProviderId) {
      return res.status(200).json({
        status: "success",
        message:
          "No ready customer to call right now. Please assign an expert first.",
      });
    }

    // 3. Check whether assigned provider is already busy serving someone else.
    const { data: busyProviders } = await supabase
      .from("queue_entries")
      .select("assigned_provider_id")
      .eq("entry_date", todayStr)
      .eq("status", "serving")
      .not("assigned_provider_id", "is", null);

    const busyProviderIds =
      busyProviders?.map((p: any) => p.assigned_provider_id) || [];
    const requiredServiceIds =
      (next as any).queue_entry_services
        ?.map((s: any) => s.service_id)
        .filter(Boolean) || [];
    if (busyProviderIds.includes(explicitProviderId)) {
      return res.status(200).json({
        status: "success",
        message:
          "No ready customer to call right now. Assigned expert is currently busy.",
      });
    }

    // 4. Validate assigned provider and capability.
    const { data: providers } = await supabase
      .from("service_providers")
      .select(`id, name, provider_services (service_id)`)
      .eq("business_id", (req as any).business_id || next.business_id || "") // Fallback to next.business_id if not in req
      .eq("is_active", true);

    const assignedProvider = providers?.find(
      (p: any) => String(p.id) === explicitProviderId,
    );
    if (!assignedProvider) {
      return res.status(200).json({
        status: "success",
        message:
          "No ready customer to call right now. Assigned expert is unavailable.",
      });
    }

    const supportsAll = (() => {
      const pServiceIds =
        assignedProvider.provider_services?.map((ps: any) => ps.service_id) ||
        [];
      return requiredServiceIds.every((rid: string) =>
        pServiceIds.includes(rid),
      );
    })();
    if (!supportsAll) {
      return res.status(200).json({
        status: "success",
        message:
          "No ready customer to call right now. Assigned expert cannot perform selected services.",
      });
    }

    const availableProvider = providers?.find((p: any) => {
      const pServiceIds =
        p.provider_services?.map((ps: any) => ps.service_id) || [];
      const supportsAll = requiredServiceIds.every((rid: string) =>
        pServiceIds.includes(rid),
      );
      const isNotBusy = !busyProviderIds.includes(p.id);
      return supportsAll && isNotBusy;
    });
    // We intentionally do not auto-switch providers when one is explicitly assigned.
    // keep `availableProvider` compatibility for downstream name interpolation only
    const providerToUse: any = assignedProvider || availableProvider;

    // 5. Start serving with assigned provider
    const now = new Date();
    const duration = Number(next.total_duration_minutes || 0);
    const estEnd = new Date(now.getTime() + duration * 60000);

    await supabase
      .from("queue_entries")
      .update({
        status: "serving",
        served_at: now.toISOString(),
        service_started_at: now.toISOString(),
        estimated_end_at: estEnd.toISOString(),
        assigned_provider_id: providerToUse.id,
      })
      .eq("id", next.id);

    res.status(200).json({
      status: "success",
      message: `Next customer ${next.ticket_number} is now being served by ${providerToUse.name}.`,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const extendTime = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { additional_minutes } = req.body;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    // Get business timezone
    const { data: eData } = await supabase
      .from("queue_entries")
      .select("queues(businesses(timezone))")
      .eq("id", id)
      .single();
    const timezone = eData?.queues?.businesses?.timezone || "UTC";
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });

    if (!additional_minutes || isNaN(additional_minutes)) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Valid additional_minutes is required",
        });
    }

    // 1. Get current entry
    const { data: entry, error: fetchError } = await supabase
      .from("queue_entries")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !entry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    if (entry.status !== "serving") {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Can only extend time for customers currently being served",
        });
    }

    const currentEstEnd = new Date(entry.estimated_end_at || new Date());
    const newEstEnd = new Date(
      currentEstEnd.getTime() + additional_minutes * 60000,
    );

    // Calculate new delay
    const startTime = new Date(entry.service_started_at);
    const totalProjectedDuration = Math.round(
      (newEstEnd.getTime() - startTime.getTime()) / 60000,
    );
    const newDelay = Math.max(
      0,
      totalProjectedDuration - (entry.total_duration_minutes || 0),
    );

    const updates: any = {
      estimated_end_at: newEstEnd.toISOString(),
      delay_minutes: newDelay,
    };

    // Delay Alert Mapping
    const lastAlerted = entry.last_alerted_delay_minutes || 0;
    let alertSent = false;

    if (newDelay - lastAlerted >= 10) {
      // Find next waiting entry
      const { data: nextPeople } = await supabase
        .from("queue_entries")
        .select("*")
        .eq("queue_id", entry.queue_id)
        .eq("entry_date", todayStr)
        .eq("status", "waiting")
        .order("position", { ascending: true })
        .limit(1);

      if (nextPeople && nextPeople.length > 0) {
        const next = nextPeople[0];
        const etaStr = newEstEnd.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: timezone,
        });
        const recipient =
          next.phone ||
          (next.user_id
            ? `User-${next.user_id}`
            : `Guest-${next.customer_name}`);

        await notificationService.sendSMS(
          recipient,
          `Hello ${next.customer_name}, there is a small delay in the queue. Your estimated turn is now around ${etaStr}. We appreciate your patience!`,
        );

        updates.last_alerted_delay_minutes = newDelay;
        alertSent = true;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("queue_entries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json({
      status: "success",
      message: alertSent
        ? "Time extended and next customer notified"
        : "Time extended",
      data: updated,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const assignTaskProvider = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_entry_service_id
    const { provider_id } = req.body;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { adminSupabase } = require("../config/supabaseClient");

    // 0. Validate if provider is on leave for this task's date
    if (provider_id) {
      const { data: taskStr } = await adminSupabase
        .from("queue_entry_services")
        .select("queue_entries!inner(entry_date)")
        .eq("id", id)
        .maybeSingle();

      if (taskStr && taskStr.queue_entries?.entry_date) {
        const entryDate = taskStr.queue_entries.entry_date;
        const { data: leaves } = await adminSupabase
          .from("provider_leaves")
          .select("id, status")
          .eq("provider_id", provider_id)
          .lte("start_date", entryDate)
          .gte("end_date", entryDate);

        const blocking = (leaves || []).filter(isBlockingApprovedLeave);
        if (blocking.length > 0) {
          return res
            .status(400)
            .json({
              status: "error",
              message:
                "This expert is on leave and cannot be assigned to tasks on this date.",
            });
        }
      }
    }

    if (provider_id) {
      const { data: providerRow } = await adminSupabase
        .from("service_providers")
        .select("id, business_id, businesses(timezone)")
        .eq("id", provider_id)
        .maybeSingle();
      if (!providerRow) {
        return res.status(400).json({ status: "error", message: "Invalid provider." });
      }
      const availability = await checkProviderAvailabilityAt(
        adminSupabase,
        providerRow.id,
        providerRow.business_id,
        (providerRow as any)?.businesses?.timezone || "UTC",
        new Date(),
      );
      if (!availability.available) {
        return res.status(400).json({
          status: "error",
          message: "This expert is currently unavailable due to schedule, leave, or blocked time.",
        });
      }
    }

    // 1. Fetch task with admin client (avoid RLS no-row .single errors)
    const { data: task, error: fetchError } = await adminSupabase
      .from("queue_entry_services")
      .select(
        "id, queue_entry_id, queue_entries!inner(queue_id, queues!inner(business_id))",
      )
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !task) {
      return res
        .status(404)
        .json({ status: "error", message: "Task not found or access denied" });
    }

    // 1b. Owner/Admin guard
    const businessId = task.queue_entries?.queues?.business_id;
    if (!businessId) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid task/business context" });
    }

    const { data: roleProfile } = await adminSupabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const isAdmin = roleProfile?.role === "admin";

    if (!isAdmin) {
      const { data: business, error: businessErr } = await adminSupabase
        .from("businesses")
        .select("owner_id")
        .eq("id", businessId)
        .maybeSingle();

      if (businessErr || !business || business.owner_id !== userId) {
        return res
          .status(403)
          .json({
            status: "error",
            message: "Unauthorized to assign provider",
          });
      }
    }

    // 2. Perform the update with admin client to bypass RLS/Constraint issues
    const { data, error } = await adminSupabase
      .from("queue_entry_services")
      .update({ assigned_provider_id: provider_id || null })
      .eq("id", id)
      .select("id, assigned_provider_id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      // Some deployments can return null representation on no-op updates.
      // Re-read row once and treat it as success if it exists.
      const { data: currentTask, error: refetchErr } = await adminSupabase
        .from("queue_entry_services")
        .select("id, assigned_provider_id")
        .eq("id", id)
        .maybeSingle();
      if (refetchErr || !currentTask) {
        return res
          .status(404)
          .json({
            status: "error",
            message: "Task not found or already updated",
          });
      }
      return res.status(200).json({
        status: "success",
        message: "Provider assigned to task successfully",
        data: currentTask,
      });
    }

    // Keep entry-level assignment fields in sync for UI cards and legacy flows.
    const { data: providerRow } = provider_id
      ? await adminSupabase
          .from("service_providers")
          .select("id, user_id")
          .eq("id", provider_id)
          .maybeSingle()
      : { data: null as any };
    await adminSupabase
      .from("queue_entries")
      .update({
        assigned_provider_id: providerRow?.id || null,
        assigned_to: providerRow?.user_id || null,
      })
      .eq("id", task.queue_entry_id);

    res.status(200).json({
      status: "success",
      message: "Provider assigned to task successfully",
      data,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

// Assuming this is the markNoShow function based on the provided edit context
export const markNoShow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_entry_id
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    // 1. Fetch the current entry to get appointment_id
    const { data: currentEntry, error: fetchError } = await supabase
      .from("queue_entries")
      .select("id, appointment_id")
      .eq("id", id)
      .single();

    if (fetchError || !currentEntry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    // 2. Mark the queue entry as 'no_show'
    const { data, error } = await supabase
      .from("queue_entries")
      .update({ status: "no_show" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 3. Sync with Appointment (if linked)
    if (currentEntry.appointment_id) {
      await supabase
        .from("appointments")
        .update({ status: "no_show" })
        .eq("id", currentEntry.appointment_id);
    }

    res.status(200).json({
      status: "success",
      message: "Customer marked as No-Show",
      data,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const startTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_entry_service_id
    const userId = req.user?.id;
    const { adminSupabase } = require("../config/supabaseClient");
    // Prefer authenticated request client first, then admin fallback.
    const writeSupabase = req.supabase || adminSupabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Fetch task (admin client: employees often lack RLS read on queue_entry_services)
    const { data: taskRows, error: taskError } = await adminSupabase
      .from("queue_entry_services")
      .select(
        `
                *,
                queue_entries!inner (
                    id, 
                    entry_date, 
                    status, 
                    customer_name, 
                    phone, 
                    user_id,
                    appointment_id,
                    queues!inner (business_id)
                )
            `,
      )
      .eq("id", id)
      .limit(1);
    const task = Array.isArray(taskRows) ? taskRows[0] : taskRows;

    if (taskError || !task) {
      return res
        .status(404)
        .json({ status: "error", message: "Task not found" });
    }

    // Some PostgREST embeds can be returned as arrays depending on relation inference.
    // Normalize once so downstream checks don't break with undefined IDs.
    const taskEntry = Array.isArray((task as any).queue_entries)
      ? (task as any).queue_entries[0]
      : (task as any).queue_entries;
    const taskQueue = Array.isArray(taskEntry?.queues)
      ? taskEntry?.queues[0]
      : taskEntry?.queues;
    const businessId = taskQueue?.business_id;
    if (!businessId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid task context: missing business information.",
      });
    }

    const { data: business } = await adminSupabase
      .from("businesses")
      .select("owner_id")
      .eq("id", businessId)
      .maybeSingle();
    const isOwner = business?.owner_id === userId;
    const myProviderRes = await adminSupabase
      .from("service_providers")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const myProvider = myProviderRes.data;
    const isAssignedEmployee =
      !!task.assigned_provider_id &&
      !!myProvider?.id &&
      task.assigned_provider_id === myProvider.id;

    if (!isOwner && !isAssignedEmployee) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to modify this task.",
      });
    }

    const providerId = task.assigned_provider_id;
    if (!providerId) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Please assign an expert to this task first.",
        });
    }

    // 1.5 Validate if provider is on leave for this task's date
    if (task.queue_entries?.entry_date) {
      const entryDate = task.queue_entries.entry_date;
      const { data: leaves } = await adminSupabase
        .from("provider_leaves")
        .select("id, status")
        .eq("provider_id", providerId)
        .lte("start_date", entryDate)
        .gte("end_date", entryDate);

      const blocking = (leaves || []).filter(isBlockingApprovedLeave);
      if (blocking.length > 0) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "This expert is on leave and cannot start tasks on this date.",
          });
      }
    }

    // 2. STRICTOR PROVIDER LOCK
    // Check if provider has ANY task 'in_progress' for this business today
    const { data: rawBusyTasks } = await adminSupabase
      .from("queue_entry_services")
      .select(
        `
                id,
                queue_entries!inner (
                    entry_date,
                    status,
                    queues!inner (business_id)
                )
            `,
      )
      .eq("assigned_provider_id", providerId)
      .eq("task_status", "in_progress");

    const busyTasks = rawBusyTasks?.filter(
      (b: any) =>
        b.queue_entries?.entry_date === taskEntry?.entry_date &&
        b.queue_entries?.queues?.business_id === businessId &&
        b.queue_entries?.status === "serving",
    );

    if (busyTasks && busyTasks.length > 0) {
      return res.status(400).json({
        status: "error",
        message:
          "The selected expert is currently attending to another guest. Please choose an available expert.",
      });
    }

    // 3. Start Task
    const now = new Date();
    const duration = Number(task.duration_minutes || 0);
    const estEnd = new Date(now.getTime() + duration * 60000);

    const startPayload = {
      task_status: "in_progress",
      started_at: now.toISOString(),
      estimated_end_at: estEnd.toISOString(),
    };
    const tryPersistStart = async (client: any) => {
      if (!client) return null;
      const { error: updateErr } = await client
        .from("queue_entry_services")
        .update(startPayload)
        .eq("id", id);
      if (updateErr) return null;
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const { data: row } = await client
          .from("queue_entry_services")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        const st = String((row as any)?.task_status || "").toLowerCase();
        if (row && st === "in_progress" && (row as any)?.started_at) {
          return row;
        }
      }
      return null;
    };

    let updatedTask: any = await tryPersistStart(writeSupabase);
    if (!updatedTask && req.supabase && req.supabase !== writeSupabase) {
      updatedTask = await tryPersistStart(req.supabase);
    }
    if (!updatedTask && adminSupabase && adminSupabase !== writeSupabase) {
      updatedTask = await tryPersistStart(adminSupabase);
    }
    if (!updatedTask) {
      return res.status(409).json({
        status: "error",
        message:
          "Task start did not persist. Please refresh and try again.",
      });
    }

    // 3.5 Recompute delays for this provider's upcoming appointments
    await recomputeProviderDelays(
      providerId,
      businessId as string,
      estEnd,
    ).catch((err: Error) => {
      console.error(
        "[queueController] Failed to recompute delays in startTask:",
        err,
      );
    });

    // 4. Update parent entry status to 'serving' if it's currently 'waiting'
    if (["waiting", "pending"].includes(String(taskEntry?.status || "").toLowerCase())) {
      await writeSupabase
        .from("queue_entries")
        .update({
          status: "serving",
          served_at: now.toISOString(),
          service_started_at: now.toISOString(), // First task start marks entry start
        })
        .eq("id", taskEntry.id);

      // Sync with parent appointment
      if (taskEntry?.appointment_id) {
        await writeSupabase
          .from("appointments")
          .update({ status: "in_service" })
          .eq("id", taskEntry.appointment_id);
      }

      // Send Notification for first service start
      const recipient =
        taskEntry?.phone ||
        (taskEntry?.user_id
          ? `User-${taskEntry.user_id}`
          : `Guest-${taskEntry?.customer_name}`);
      const etaStr = estEnd.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      });
      await notificationService.sendSMS(
        recipient,
        `Hello ${taskEntry?.customer_name || "Guest"}, your service has started! Estimated time for this task: ${etaStr}. Thank you!`,
      );
    }

    res.status(200).json({
      status: "success",
      message: "Task started successfully",
      data: updatedTask,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const completeTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // queue_entry_service_id
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const { adminSupabase } = require("../config/supabaseClient");
    // Prefer authenticated request client first (honors user context),
    // then fallback to admin client when available.
    const writeSupabase =
      req.supabase || adminSupabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Fetch task details and business owner info (admin client: employee RLS + correct service id required)
    const { data: taskRows, error: taskError } = await adminSupabase
      .from("queue_entry_services")
      .select(
        `
                *,
                queue_entries!inner (
                    id, 
                    appointment_id, 
                    queues!inner(
                        business_id,
                        businesses!inner(owner_id)
                    )
                )
            `,
      )
      .eq("id", id)
      .limit(1);
    const task = Array.isArray(taskRows) ? taskRows[0] : taskRows;

    if (taskError || !task) {
      return res
        .status(404)
        .json({ status: "error", message: "Task not found" });
    }

    // PERMISSION CHECK: Must be the assigned provider (service_providers.id) OR the business owner
    const ownerId = task.queue_entries?.queues?.businesses?.owner_id;
    const isOwner = ownerId === userId;
    const { data: myProvider } = await adminSupabase
      .from("service_providers")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const isAssignedEmployee =
      !!task.assigned_provider_id &&
      !!myProvider?.id &&
      task.assigned_provider_id === myProvider.id;

    if (!isOwner && !isAssignedEmployee) {
      return res.status(403).json({
        status: "error",
        message:
          "You do not have permission to complete this task. Only the assigned employee or owner can do this.",
      });
    }

    if (!task.started_at) {
      return res.status(400).json({
        status: "error",
        message:
          "This task hasn't been started yet. Please start the task before completion.",
      });
    }

    // 2. Calculate metrics
    const now = new Date();
    const startedAt = new Date(task.started_at);
    const actualMinutes = Math.round(
      (now.getTime() - startedAt.getTime()) / 60000,
    );
    const delayMinutes = Math.max(
      0,
      actualMinutes - (task.duration_minutes || 0),
    );

    // 3. Mark task as done
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const userRole =
      profile?.role === "owner" || profile?.role === "admin" || isOwner
        ? "OWNER"
        : "EMPLOYEE";

    const completionPayload = {
      task_status: "done",
      completed_at: now.toISOString(),
      actual_minutes: actualMinutes,
      delay_minutes: delayMinutes,
      completed_by_id: userId,
      completed_by_role: userRole,
    };

    const tryPersistCompletion = async (client: any) => {
      if (!client) return null;
      const { error: updateErr } = await client
        .from("queue_entry_services")
        .update(completionPayload)
        .eq("id", id);
      if (updateErr) return null;

      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const { data: row } = await client
          .from("queue_entry_services")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        const st = String((row as any)?.task_status || "").toLowerCase();
        if (row && ["done", "completed"].includes(st) && (row as any)?.completed_at) {
          return row;
        }
      }
      return null;
    };

    let updatedTask: any = await tryPersistCompletion(writeSupabase);
    if (!updatedTask && req.supabase && req.supabase !== writeSupabase) {
      updatedTask = await tryPersistCompletion(req.supabase);
    }
    if (!updatedTask && adminSupabase && adminSupabase !== writeSupabase) {
      updatedTask = await tryPersistCompletion(adminSupabase);
    }
    if (!updatedTask) {
      return res.status(409).json({
        status: "error",
        message: "Task completion did not persist. Please refresh and try again.",
      });
    }

    // Recompute delays based on actual completion time
    if (task.assigned_provider_id && task.queue_entries?.queues?.business_id) {
      await recomputeProviderDelays(
        task.assigned_provider_id,
        task.queue_entries.queues.business_id,
        now,
      ).catch((err) => {
        console.error(
          "[queueController] Failed to recompute delays in completeTask:",
          err,
        );
      });
    }

    // 4. Check if ALL tasks for this entry are done
    const { data: allTasks } = await adminSupabase
      .from("queue_entry_services")
      .select("task_status")
      .eq("queue_entry_id", task.queue_entry_id);

    const terminalTaskStatuses = new Set([
      "done",
      "completed",
      "cancelled",
      "skipped",
    ]);
    const allDone =
      (allTasks || []).length > 0 &&
      (allTasks || []).every((t: any) => {
        const status = String(t?.task_status || "").toLowerCase();
        return terminalTaskStatuses.has(status);
      });

    if (allDone) {
      // Auto-complete the whole entry
      await adminSupabase
        .from("queue_entries")
        .update({
          status: "completed",
          completed_at: now.toISOString(),
          completed_by_id: userId,
          completed_by_role: userRole,
        })
        .eq("id", task.queue_entry_id);

      // Sync with parent appointment
      if (task.queue_entries.appointment_id) {
        await adminSupabase
          .from("appointments")
          .update({
            status: "completed",
            completed_at: now.toISOString(),
          })
          .eq("id", task.queue_entries.appointment_id);
      }
    }

    res.status(200).json({
      status: "success",
      message: allDone
        ? "All services completed. Guest session finished."
        : "Task completed successfully",
      data: updatedTask,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const skipQueueEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Get current entry
    const { data: currentEntry } = await supabase
      .from("queue_entries")
      .select("*")
      .eq("id", id)
      .single();

    if (!currentEntry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    if (currentEntry.status !== "waiting") {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Can only skip customers who are in the waiting list.",
        });
    }

    // 2. Find the entry immediately after this one (next position)
    const { data: nextEntry } = await supabase
      .from("queue_entries")
      .select("id, position")
      .eq("queue_id", currentEntry.queue_id)
      .eq("entry_date", currentEntry.entry_date)
      .eq("status", "waiting")
      .gt("position", currentEntry.position)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!nextEntry) {
      return res
        .status(400)
        .json({ status: "error", message: "queue.err_end_reached" });
    }

    // 3. Swap positions
    const tempPos = 999999 + Math.floor(Math.random() * 1000);

    await supabase
      .from("queue_entries")
      .update({ position: tempPos })
      .eq("id", currentEntry.id);
    await supabase
      .from("queue_entries")
      .update({ position: currentEntry.position })
      .eq("id", nextEntry.id);
    await supabase
      .from("queue_entries")
      .update({ position: nextEntry.position })
      .eq("id", currentEntry.id);

    // Trigger notifications as positions have swapped
    await processQueueNotifications(
      currentEntry.queue_id,
      currentEntry.entry_date,
      supabase,
    );

    res.status(200).json({
      status: "success",
      message: `Customer ${currentEntry.ticket_number} skipped. Moved down 1 position.`,
      data: { id: currentEntry.id, new_position: nextEntry.position },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const updateQueueEntryPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { payment_method } = req.body;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // Verify ownership and get appointment_id
    const { data: entry, error: fetchError } = await supabase
      .from("queue_entries")
      .select("appointment_id, total_price, queues!inner(business_id)")
      .eq("id", id)
      .single();

    if (fetchError || !entry) {
      return res
        .status(404)
        .json({ status: "error", message: "Queue entry not found" });
    }

    const { data: businessInfo } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", entry.queues.business_id)
      .single();

    if (!businessInfo || businessInfo.owner_id !== userId) {
      return res.status(403).json({ status: "error", message: "Unauthorized" });
    }

    const now = new Date().toISOString();

    // 1. Update Queue Entry
    const { data, error } = await supabase
      .from("queue_entries")
      .update({
        payment_method,
        payment_status: "paid",
        paid_at: now,
        amount_paid: entry.total_price || 0,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 2. Sync with Appointment (if linked)
    if (entry.appointment_id) {
      await supabase
        .from("appointments")
        .update({
          status: "completed",
          payment_status: "paid",
          payment_method,
          paid_at: now,
          completed_at: now,
          amount_paid: data.total_price || 0, // Sync total price if available
        })
        .eq("id", entry.appointment_id);
    }

    res.status(200).json({
      status: "success",
      message: "Payment updated successfully",
      data,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const restoreQueueEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    // 1. Get current entry
    const { data: entry } = await supabase
      .from("queue_entries")
      .select(
        `
                *,
                queues!inner (business_id)
            `,
      )
      .eq("id", id)
      .single();

    if (!entry) {
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    // Verify ownership
    const { data: biz } = await supabase
      .from("businesses")
      .select("owner_id, timezone")
      .eq("id", entry.queues.business_id)
      .single();
    if (biz?.owner_id !== userId)
      return res.status(403).json({ status: "error", message: "Forbidden" });

    // Verify it's from today (Only allow restoration for same-day no-shows)
    const timezone = biz?.timezone || "UTC";
    const todayStr = getLocalDateString(timezone);

    if (entry.entry_date !== todayStr) {
      return res.status(400).json({
        status: "error",
        message:
          "Cannot restore no-shows from previous days. Please ask the customer to join the queue again.",
      });
    }

    // 2. Find MAX position for today to "add to live queue" (at the end)
    const { data: maxPosData } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("queue_id", entry.queue_id)
      .eq("entry_date", todayStr)
      .order("position", { ascending: false })
      .limit(1);

    const nextPosition =
      maxPosData && maxPosData.length > 0 ? maxPosData[0].position + 1 : 1;

    // 3. Update entry status and position
    const { data, error } = await supabase
      .from("queue_entries")
      .update({
        status: "waiting",
        position: nextPosition,
        assigned_provider_id: null, // Reset provider just in case
        service_started_at: null, // Reset serving timestamps
        served_at: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 4. Reset task status in junction table so they can be started/done again
    await supabase
      .from("queue_entry_services")
      .update({
        task_status: "pending",
        assigned_provider_id: null,
        started_at: null,
        completed_at: null,
        actual_minutes: null,
        delay_minutes: null,
      })
      .eq("queue_entry_id", id);

    // 5. Sync with Appointment (if linked)
    if (entry.appointment_id) {
      await supabase
        .from("appointments")
        .update({
          status: "checked_in", // Use 'checked_in' to break the loop (getTodayQueue only looks for 'confirmed')
          checked_in_at: new Date().toISOString(), // Backup marker
        })
        .eq("id", entry.appointment_id);
    }

    // 6. Trigger position updates and notifications
    await processQueueNotifications(entry.queue_id, todayStr, supabase);

    res.status(200).json({
      status: "success",
      message: "Customer restored and added to the end of the live queue",
      data,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const initializeEntryTasks = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { provider_id } = req.body;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;

    // 1. Check if tasks already exist
    const { data: existing } = await supabase
      .from("queue_entry_services")
      .select("id")
      .eq("queue_entry_id", id);

    if (existing && existing.length > 0) {
      // If tasks already exist and provider is now selected, treat this as assignment.
      if (provider_id) {
        await supabase
          .from("queue_entry_services")
          .update({ assigned_provider_id: provider_id })
          .eq("queue_entry_id", id);

        const { data: providerRow } = await supabase
          .from("service_providers")
          .select("id, user_id")
          .eq("id", provider_id)
          .maybeSingle();

        await supabase
          .from("queue_entries")
          .update({
            assigned_provider_id: providerRow?.id || provider_id,
            assigned_to: providerRow?.user_id || null,
          })
          .eq("id", id);
      }
      return res
        .status(200)
        .json({
          status: "success",
          message: provider_id
            ? "Provider assigned successfully"
            : "Tasks already initialized",
        });
    }

    // 2. Fetch entry and business info simply
    const { data: entry, error: entryErr } = await supabase
      .from("queue_entries")
      .select(
        `
                id,
                queue_id
            `,
      )
      .eq("id", id)
      .single();

    if (entryErr || !entry) {
      console.error("[initializeEntryTasks] Entry not found:", id, entryErr);
      return res
        .status(404)
        .json({ status: "error", message: "Entry not found" });
    }

    const { data: queueData } = await supabase
      .from("queues")
      .select("business_id, businesses(default_price, default_duration)")
      .eq("id", entry.queue_id)
      .single();

    // 3. Insert default manual service slot (Assign provider immediately if provided)
    const fallbackService = await resolveDefaultServiceForBusiness(
      supabase,
      queueData?.business_id,
      true,
      (queueData as any)?.businesses?.default_duration || 10,
      (queueData as any)?.businesses?.default_price || 0,
    );
    if (!fallbackService?.id) {
      return res.status(400).json({
        status: "error",
        message:
          "No services are configured for this business. Please add at least one service first.",
      });
    }
    await supabase.from("queue_entry_services").insert([
      {
        queue_entry_id: id,
        service_id: fallbackService.id,
        assigned_provider_id: provider_id || null,
        price: (queueData as any)?.businesses?.default_price || 0,
        duration_minutes:
          (queueData as any)?.businesses?.default_duration || 10,
        task_status: provider_id ? "pending" : "pending",
      },
    ]);

    // If provider was assigned, also sync it back to the entry level for legacy rows.
    // queue_entries.assigned_to stores employee user_id (not provider id).
    if (provider_id) {
      const { data: providerRow } = await supabase
        .from("service_providers")
        .select("id, user_id")
        .eq("id", provider_id)
        .maybeSingle();
      await supabase
        .from("queue_entries")
        .update({
          assigned_provider_id: providerRow?.id || provider_id,
          assigned_to: providerRow?.user_id || null,
        })
        .eq("id", id);
    }

    res.status(200).json({ status: "success", message: "Tasks initialized" });
  } catch (error: any) {
    console.error("[initializeEntryTasks] Global error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};
