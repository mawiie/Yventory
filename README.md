# Yventory

A minimal donation inventory app for NGOs receiving, sorting, and distributing donated items.

## Stack

- Vite React
- Supabase Auth
- Supabase Postgres with RLS
- Supabase Storage for item photos
- Supabase Edge Function for admin staff invitations

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project and copy `.env.example` to `.env.local`.

3. Run the SQL migrations in order:

   - `supabase/migrations/001_initial_inventory.sql`
   - `supabase/migrations/002_storage_locations.sql`
   - `supabase/migrations/003_inventory_movements.sql`
   - `supabase/migrations/004_collections.sql`
   - `supabase/migrations/005_add_super_admin_role.sql`
   - `supabase/migrations/006_super_admin_policies.sql`
   - `supabase/migrations/007_inventory_visibility.sql`

4. Deploy the invite function:

   ```bash
   supabase functions deploy invite-user
   supabase secrets set SERVICE_ROLE_KEY=your-service-role-key
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

## First admin

After the first user signs up, set their profile role to `admin` in Supabase SQL:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.org';
```

Admins can invite staff from the Admin screen. Regular signups become read-only users.
