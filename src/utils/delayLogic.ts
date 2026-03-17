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
        
        // 0. Fetch business timezone
        const { data: business } = await supabase
            .from('businesses')
            .select('timezone')
            .eq('id', businessId)
            .single();
        
        const timezone = business?.timezone || 'UTC';
        const todayStr = require('./timeUtils').getLocalDateString(timezone);

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
            // Since appointment_time is HH:mm:ss or HH:mm, we combine with date and parse in local timezone
            const [h, m] = appt.appointment_time.split(':').map(Number);
            const apptStart = new Date(appt.appointment_date);
            // We need to set the time correctly in the business timezone.
            // A simple way is to use the offset, but offsets change.
            // For now, let's use the same logic as elsewhere or assume the DB stores it in a way we can combine.
            
            // Actually, we can just compare minutes since midnight for simplicity
            const apptMins = h * 60 + m;
            const rollingMins = require('./timeUtils').getLocalMinutes(timezone, rollingEstEnd);
            
            const delayMinutes = Math.max(0, rollingMins - apptMins);

            const expectedStartAt = new Date(rollingEstEnd.getTime() > new Date(appt.appointment_date + 'T' + appt.appointment_time).getTime() ? rollingEstEnd.getTime() : new Date(appt.appointment_date + 'T' + appt.appointment_time).getTime()); // Simplified
            const duration = Number(appt.duration_minutes || 0);
            const expectedEndAt = new Date(expectedStartAt.getTime() + duration * 60000);
            const isDelayed = delayMinutes >= 10;

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
                const expectedTimeStr = expectedStartAt.toLocaleTimeString('en-IN', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    timeZone: timezone 
                });
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
