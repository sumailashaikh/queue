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
}
