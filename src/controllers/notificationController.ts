import { Request, Response } from "express";

const isMissingNotificationsTableError = (error: any) => {
  const raw = String(error?.message || error?.details || "").toLowerCase();
  return (
    raw.includes("could not find the table") &&
    raw.includes("notifications")
  ) || (
    raw.includes("relation") &&
    raw.includes("notifications") &&
    raw.includes("does not exist")
  );
};

export const listMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const adminSupabase = require("../config/supabaseClient").adminSupabase;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, role")
      .eq("id", userId)
      .maybeSingle();

    const { data: ownedBusinesses } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", userId);

    const ownedBusinessIds = (ownedBusinesses || [])
      .map((b: any) => String(b?.id || ""))
      .filter(Boolean);
    const primaryBusinessId = profile?.business_id || ownedBusinessIds[0] || null;

    if (!primaryBusinessId) {
      return res.status(200).json({ status: "success", data: [], unread: 0 });
    }

    const isOwnerLike =
      ["owner", "admin", "manager", "business_owner"].includes(
        String(profile?.role || "").toLowerCase(),
      ) || ownedBusinessIds.length > 0;

    let query = adminSupabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (ownedBusinessIds.length > 1 && isOwnerLike) {
      query = query.in("business_id", ownedBusinessIds);
    } else {
      query = query.eq("business_id", primaryBusinessId);
    }

    if (!isOwnerLike) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingNotificationsTableError(error)) {
        return res.status(200).json({ status: "success", data: [], unread: 0 });
      }
      throw error;
    }

    const unread = (data || []).filter((n: any) => !n.is_read).length;
    return res.status(200).json({ status: "success", data: data || [], unread });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const markNotificationRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const adminSupabase = require("../config/supabaseClient").adminSupabase;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: existing, error: fetchError } = await adminSupabase
      .from("notifications")
      .select("id, business_id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) {
      if (isMissingNotificationsTableError(fetchError)) {
        return res.status(200).json({ status: "success" });
      }
      throw fetchError;
    }
    if (!existing) {
      return res
        .status(404)
        .json({ status: "error", message: "Notification not found" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, role")
      .eq("id", userId)
      .maybeSingle();
    const { data: ownedBusinesses } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", userId);
    const ownedBusinessIds = new Set(
      (ownedBusinesses || []).map((b: any) => String(b?.id || "")).filter(Boolean),
    );
    const isOwnerLike =
      ["owner", "admin", "manager", "business_owner"].includes(
        String(profile?.role || "").toLowerCase(),
      ) || ownedBusinessIds.size > 0;
    const belongsToProfileBusiness =
      !!profile?.business_id &&
      String(profile.business_id) === String(existing.business_id);
    const belongsToOwnedBusiness = ownedBusinessIds.has(String(existing.business_id));
    if (!belongsToProfileBusiness && !belongsToOwnedBusiness) {
      return res.status(403).json({ status: "error", message: "Unauthorized" });
    }

    if (!isOwnerLike) {
      const { data: ownRow } = await adminSupabase
        .from("notifications")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!ownRow) {
        return res.status(403).json({ status: "error", message: "Unauthorized" });
      }
    }

    const { error } = await adminSupabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      if (isMissingNotificationsTableError(error)) {
        return res.status(200).json({ status: "success" });
      }
      throw error;
    }

    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    const adminSupabase = require("../config/supabaseClient").adminSupabase;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, role")
      .eq("id", userId)
      .maybeSingle();
    const { data: ownedBusinesses } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", userId);
    const ownedBusinessIds = (ownedBusinesses || [])
      .map((b: any) => String(b?.id || ""))
      .filter(Boolean);
    const primaryBusinessId = profile?.business_id || ownedBusinessIds[0] || null;
    if (!primaryBusinessId) {
      return res.status(200).json({ status: "success" });
    }

    const isOwnerLike =
      ["owner", "admin", "manager", "business_owner"].includes(
        String(profile?.role || "").toLowerCase(),
      ) || ownedBusinessIds.length > 0;
    let query = adminSupabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("is_read", false);

    if (ownedBusinessIds.length > 1 && isOwnerLike) {
      query = query.in("business_id", ownedBusinessIds);
    } else {
      query = query.eq("business_id", primaryBusinessId);
    }

    if (!isOwnerLike) {
      query = query.eq("user_id", userId);
    }

    const { error } = await query;
    if (error) {
      if (isMissingNotificationsTableError(error)) {
        return res.status(200).json({ status: "success" });
      }
      throw error;
    }
    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};
