
# Queue System API Reference

**Base URL:** `http://localhost:4000`
**Headers:** `Authorization: Bearer <YOUR_ACCESS_TOKEN>` (Except for Login)

---

## 1. Authentication (Customers & Owners)
- **Send OTP:**
  - `POST /api/auth/send-otp`
  - Body: `{ "phone": "+919999999999" }`
- **Verify OTP (Login):**
  - `POST /api/auth/verify-otp`
  - Body: `{ "phone": "+919999999999", "otp": "123456" }`
  - **Returns:** `access_token` (Use this for all other requests)

---

## 2. Business Management (Owners)
  - `POST /api/businesses`
  - Body: `{ "name": "My Salon", "slug": "mysalon", "address": "123 Street", "phone": "9876543210", "description": "Best salon in town" }`
- **Get My Business (Profile):**
  - `GET /api/businesses/me`
- **Update Business:**
  - `PUT /api/businesses/:id` (Get ID from "Get My Business")
  - Body: `{ "name": "My New Salon Name" }`
- **Delete Business:**
  - `DELETE /api/businesses/:id`

---

## 3. Queue Management (Owners)
- **Create Queue:**
  - `POST /api/queues`
  - Body: `{ "name": "Checkup Queue", "description": "General Checkup", "status": "open" }`
- **Get All My Queues:**
  - `GET /api/queues/my`
- **Update Queue:**
  - `PUT /api/queues/:id`
  - Body: `{ "status": "closed", "current_wait_time_minutes": 15 }`
- **Delete Queue:**
  - `DELETE /api/queues/:id`

---

## 4. Operational Dashboard (Daily Workflow)
- **Get Today's Queue (Live View):**
  - `GET /api/queues/:id/today` (Replace `:id` with your Queue ID)
  - Returns: List of customers waiting *today*.
- **Update Customer Status:**
  - `PUT /api/queues/entries/:id/status` (Replace `:id` with Queue Entry ID from the list above)
  - Body: `{ "status": "serving" }` or `{ "status": "completed" }` or `{ "status": "no_show" }`

---

## 5. Customer Actions (End Users)
- **Join Queue:**
  - `POST /api/queues/join`
  - Body: `{ "queue_id": "UUID_OF_THE_QUEUE", "customer_name": "John Doe" }`

---

## 6. Services Management (Owners)
- **Create Service:**
  - `POST /api/services`
  - Body: `{ "name": "Basic Haircut", "description": "30 min cut", "duration_minutes": 30, "price": 500, "business_id": "UUID" }`
- **Get My Services:**
  - `GET /api/services/my`
- **Delete Service:**
  - `DELETE /api/services/:id`

---

## 7. Appointment Management (Owners & Customers)
- **Book Appointment (Customer):**
  - `POST /api/appointments`
  - Body: `{ "business_id": "UUID", "service_id": "UUID", "start_time": "2023-10-27T10:00:00Z", "end_time": "2023-10-27T10:30:00Z" }`
- **Get My Appointments (Customer):**
  - `GET /api/appointments/my`
  - Body: None (Uses Authorization header)
- **Get Business Appointments (Owner):**
  - `GET /api/appointments/business`
  - Body: None (Uses Authorization header)
- **Update Appointment Status (Owner):**
  - `PUT /api/appointments/:appointment_id/status` (Replace `:appointment_id` with the ID from the list above)
  - Body: `{ "status": "confirmed" }` (Values: 'confirmed', 'completed', 'cancelled')
