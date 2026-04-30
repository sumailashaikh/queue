import { Request, Response } from "express";

export const listMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase =
      req.supabase || require("../config/supabaseClient").supabase;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, role")
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.business_id) {
      return res.status(200).json({ status: "success", data: [], unread: 0 });
    }

    const isOwnerLike = ["owner", "admin"].includes(
      String(profile.role || "").toLowerCase(),
    );

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("business_id", profile.business_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!isOwnerLike) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;
    if (error) throw error;

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
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("notifications")
      .select("id, business_id")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
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
    const isOwnerLike = ["owner", "admin"].includes(
      String(profile?.role || "").toLowerCase(),
    );
    if (!profile?.business_id || profile.business_id !== existing.business_id) {
      return res.status(403).json({ status: "error", message: "Unauthorized" });
    }

    if (!isOwnerLike) {
      const { data: ownRow } = await supabase
        .from("notifications")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!ownRow) {
        return res.status(403).json({ status: "error", message: "Unauthorized" });
      }
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

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
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id, role")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.business_id) {
      return res.status(200).json({ status: "success" });
    }

    const isOwnerLike = ["owner", "admin"].includes(
      String(profile.role || "").toLowerCase(),
    );
    let query = supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("business_id", profile.business_id)
      .eq("is_read", false);

    if (!isOwnerLike) {
      query = query.eq("user_id", userId);
    }

    const { error } = await query;
    if (error) throw error;
    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};
