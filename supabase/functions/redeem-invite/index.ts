import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Redeem function is missing Supabase environment variables.");
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      return json({ error: "Sign in before accepting this invitation." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user?.email) {
      return json({ error: "Sign in before accepting this invitation." }, 401);
    }

    const body = (await request.json()) as { token?: string };
    const token = body.token?.trim();
    if (!token) {
      return json({ error: "Invitation token is required." }, 400);
    }

    const tokenHash = await sha256(token);
    const { data: invite, error: inviteError } = await adminClient
      .from("pending_invites")
      .select("id,email,full_name,role,expires_at,redeemed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite || invite.redeemed_at) {
      return json({ error: "This invitation is no longer valid." }, 400);
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return json({ error: "This invitation has expired." }, 400);
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: `Sign in with ${invite.email} to accept this invitation.` }, 403);
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: invite.full_name ?? user.user_metadata?.full_name ?? null,
      role: invite.role,
    });

    if (profileError) throw profileError;

    const { error: redeemError } = await adminClient
      .from("pending_invites")
      .update({
        redeemed_at: new Date().toISOString(),
        redeemed_by: user.id,
      })
      .eq("id", invite.id);

    if (redeemError) throw redeemError;

    return json({ ok: true, role: invite.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite redemption failed.";
    return json({ error: message }, 500);
  }
});

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
