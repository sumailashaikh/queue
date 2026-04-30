import { Request, Response } from "express";

const UPI_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

const buildQrUrl = (upiId: string, businessName: string) => {
  const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(businessName || "Business")}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(upiUrl)}`;
};

export const savePaymentSettings = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { business_id, upi_id } = req.body || {};
    const supabase = req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    if (!business_id || !upi_id) {
      return res.status(400).json({ status: "error", message: "business_id and upi_id are required" });
    }

    const normalizedUpi = String(upi_id).trim();
    if (!UPI_REGEX.test(normalizedUpi)) {
      return res.status(400).json({ status: "error", message: "Invalid UPI ID format" });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, owner_id, name")
      .eq("id", business_id)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ status: "error", message: "Business not found" });
    }
    if (business.owner_id !== userId) {
      return res.status(403).json({ status: "error", message: "Only business owner can update payment settings" });
    }

    const qr_code_url = buildQrUrl(normalizedUpi, business.name);
    const payload = {
      business_id: business.id,
      upi_id: normalizedUpi,
      qr_code_url,
      qr_type: "generated",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("business_payment_settings")
      .upsert(payload, { onConflict: "business_id" })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      message: "Payment settings saved",
      data,
    });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

export const getPaymentSettingsByBusiness = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { businessId } = req.params;
    const supabase = req.supabase || require("../config/supabaseClient").supabase;

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, owner_id")
      .eq("id", businessId)
      .single();
    if (businessError || !business) {
      return res.status(404).json({ status: "error", message: "Business not found" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, business_id")
      .eq("id", userId)
      .maybeSingle();
    const canAccess =
      profile?.role === "admin" ||
      business.owner_id === userId ||
      (profile?.business_id && String(profile.business_id) === String(business.id));
    if (!canAccess) {
      return res.status(403).json({ status: "error", message: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("business_payment_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: data || null,
      message: data ? "Payment setup complete" : "No payment method added",
    });
  } catch (error: any) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

