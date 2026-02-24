import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';

/**
 * Recomputes the delay for all upcoming appointments for a specific provider
 * based on their currently estimated end time.
 * @param providerId The ID of the expert
 * @param businessId The ID of the business
 * @param currentTaskEstEnd The estimated end time of the task that just started or updated
 */
export const recomputeProviderDelays = async (providerId: string, businessId: string, currentTaskEstEnd: Date) => {
    try {
        console.log(`[delayLogic] Recomputing delays for provider ${providerId} starting from ${currentTaskEstEnd.toISOString()}`);

        // 1. Fetch upcoming appointments for this provider today that are NOT in_service, completed, cancelled, or no_show
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        const { data: upcomingAppointments, error } = await supabase
            .from('appointments')
            .select('*')
            .eq('business_id', businessId)
            .eq('provider_id', providerId)
            .eq('appointment_date', todayStr)
            .in('status', ['scheduled', 'confirmed', 'checked_in'])
            .order('appointment_time', { ascending: true });

        if (error || !upcomingAppointments) {
            console.error('[delayLogic] Error fetching upcoming appointments:', error);
            return;
        }

        let rollingEstEnd = new Date(currentTaskEstEnd.getTime());

        for (const appt of upcomingAppointments) {
            // Parse the scheduled start time of the appointment
            const apptStart = new Date(`${appt.appointment_date}T${appt.appointment_time}+05:30`);

            // Calculate delay minutes: max(0, rollingEstEnd - apptStart)
            const diffMs = rollingEstEnd.getTime() - apptStart.getTime();
            const delayMinutes = Math.max(0, Math.floor(diffMs / 60000));

            const expectedStartAt = new Date(apptStart.getTime() + delayMinutes * 60000);
            const duration = Number(appt.duration_minutes || 0);
            const expectedEndAt = new Date(expectedStartAt.getTime() + duration * 60000);
            const isDelayed = delayMinutes >= 10;

            console.log(`[delayLogic] Appt ${appt.id} scheduled at ${apptStart.toISOString()}, expected at ${expectedStartAt.toISOString()} (Delay: ${delayMinutes}m)`);

            // Check if we need to send a notification
            // We only send if it crossed the 10m threshold AND it hasn't been delayed previously (we can check if is_delayed was false before)
            const shouldNotify = isDelayed && !appt.is_delayed;

            // Update the appointment
            await supabase
                .from('appointments')
                .update({
                    delay_minutes: delayMinutes,
                    expected_start_at: expectedStartAt.toISOString(),
                    expected_end_at: expectedEndAt.toISOString(),
                    is_delayed: isDelayed
                })
                .eq('id', appt.id);

            if (shouldNotify && appt.phone) {
                const expectedTimeStr = expectedStartAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
                const message = `We're currently serving guests and operating at full capacity. Your appointment is expected at ${expectedTimeStr}. Thank you for your patience.`;
                console.log(`[delayLogic] Sending delay WhatsApp to ${appt.phone}: ${message}`);

                await notificationService.sendWhatsApp(appt.phone, message);
            }

            // Update rolling end for the next appointment in the loop
            // If this appointment is delayed, it pushes back the next one.
            // If it's not delayed, rollingEstEnd becomes the expected end of THIS appointment.
            rollingEstEnd = new Date(expectedEndAt.getTime());
        }

    } catch (e) {
        console.error('[delayLogic] Recompute error:', e);
    }
};
