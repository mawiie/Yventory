import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AppRole = "super_admin" | "admin" | "staff" | "user";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Invite function is missing Supabase environment variables.");
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      return json({ error: "Missing authorization header." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Invalid user session." }, 401);
    }

    const { data: requester, error: requesterError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (requesterError || !["admin", "super_admin"].includes(requester?.role)) {
      return json({ error: "Only admins can invite accounts." }, 403);
    }

    const body = (await request.json()) as {
      email?: string;
      role?: AppRole;
      fullName?: string | null;
    };

    const email = body.email?.trim().toLowerCase();
    const role = body.role ?? "staff";
    const fullName = body.fullName?.trim() || null;

    if (!email) {
      return json({ error: "Email is required." }, 400);
    }

    if (!["admin", "staff", "user"].includes(role)) {
      return json({ error: "Invalid role." }, 400);
    }

    if (role === "admin" && requester.role !== "super_admin") {
      return json({ error: "Only super admins can invite admins." }, 403);
    }

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          invited_role: role,
        },
      },
    );

    if (inviteError) {
      throw inviteError;
    }

    if (invited.user?.id) {
      const { error: profileError } = await adminClient.from("profiles").upsert({
        id: invited.user.id,
        email,
        full_name: fullName,
        role,
      });

      if (profileError) {
        throw profileError;
      }
    }

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite failed.";
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
