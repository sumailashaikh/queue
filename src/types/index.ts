export interface Profile {
    id: string; // UUID from auth.users
    full_name: string | null;
    role: 'admin' | 'staff' | 'customer';
    created_at: string;
}

export interface Business {
    id: string; // UUID
    owner_id: string; // References Profile
    name: string;
    slug: string;
    address?: string | null;
    phone?: string | null;
    whatsapp_number?: string | null;
    open_time: string; // HH:mm:ss
    close_time: string; // HH:mm:ss
    is_closed: boolean;
    created_at: string;
}

export interface Service {
    id: string; // UUID
    business_id?: string | null; // Nullable during migration, but should be linked
    name: string;
    description?: string | null;
    duration_minutes: number;
    price: number;
    created_at: string;
}

export interface Queue {
    id: string; // UUID
    business_id?: string | null;
    service_id?: string | null;
    name: string;
    status: 'open' | 'closed' | 'paused';
    current_wait_time_minutes: number;
    created_at: string;
}

export interface QueueEntry {
    id: string;
    queue_id: string;
    user_id?: string | null;
    customer_name: string;
    status: 'waiting' | 'serving' | 'completed' | 'cancelled' | 'no_show';
    position: number;
    ticket_number: string;
    joined_at: string;
    served_at?: string | null;
    completed_at?: string | null;
    total_price: number;
    total_duration_minutes: number;
    service_started_at?: string | null;
    estimated_end_at?: string | null;
    actual_duration_minutes?: number | null;
    delay_minutes: number;
    assigned_provider_id?: string | null;
}

export interface ServiceProvider {
    id: string;
    business_id: string;
    name: string;
    phone?: string | null;
    role?: string | null;
    department?: string | null;
    is_active: boolean;
    created_at: string;
}

export interface ProviderService {
    id: string;
    provider_id: string;
    service_id: string;
    created_at: string;
}

export interface ProviderAvailability {
    id: string;
    provider_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_available: boolean;
    created_at: string;
}
