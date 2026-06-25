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
      siteUrl?: string;
    };

    const email = body.email?.trim().toLowerCase();
    const role = body.role ?? "staff";
    const fullName = body.fullName?.trim() || null;
    const siteUrl = normalizeSiteUrl(Deno.env.get("APP_SITE_URL") || body.siteUrl);

    if (!email) {
      return json({ error: "Email is required." }, 400);
    }

    if (!["admin", "staff", "user"].includes(role)) {
      return json({ error: "Invalid role." }, 400);
    }

    if (role === "admin" && requester.role !== "super_admin") {
      return json({ error: "Only super admins can invite admins." }, 403);
    }

    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokenHash = await sha256(token);
    const inviteUrl = `${siteUrl}/accept-invite?token=${encodeURIComponent(token)}`;

    const { error: inviteError } = await adminClient.from("pending_invites").insert({
      email,
      full_name: fullName,
      role,
      token_hash: tokenHash,
      invited_by: user.id,
    });

    if (inviteError) {
      throw inviteError;
    }

    const emailSent = await sendInviteEmail({
      email,
      fullName,
      role,
      inviteUrl,
    }).catch((error) => {
      console.error(error);
      return false;
    });

    return json({ ok: true, inviteUrl, emailSent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite failed.";
    return json({ error: message }, 500);
  }
});

function normalizeSiteUrl(siteUrl?: string) {
  if (!siteUrl) throw new Error("Site URL is required.");
  const url = new URL(siteUrl);
  return url.origin;
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sendInviteEmail({
  email,
  fullName,
  role,
  inviteUrl,
}: {
  email: string;
  fullName: string | null;
  role: AppRole;
  inviteUrl: string;
}) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("INVITE_FROM_EMAIL");

  if (!resendApiKey || !fromEmail) {
    return false;
  }

  const roleLabel = role === "user" ? "read-only" : role.replace("_", " ");
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: "You're invited to Yventory",
      html: `
        <p>${greeting}</p>
        <p>You have been invited to Yventory with <strong>${roleLabel}</strong> access.</p>
        <p>Create an account or sign in with this email address, then accept the invite:</p>
        <p><a href="${inviteUrl}">Accept invitation</a></p>
        <p>This invitation expires in 7 days.</p>
      `,
      text: `${greeting}

You have been invited to Yventory with ${roleLabel} access.

Create an account or sign in with this email address, then accept the invite:
${inviteUrl}

This invitation expires in 7 days.`,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Invite was created, but email sending failed: ${message}`);
  }

  return true;
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
