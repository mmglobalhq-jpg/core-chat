// Supabase Edge Function: signup-approval (verify_jwt = false; custom auth).
//
// POST  (from the DB webhook on public.profiles insert): reads ONLY the row id,
//       re-loads the profile server-side (service_role), and — if unapproved and
//       non-admin — emails the admin a signed (HMAC) approval link via Resend.
// GET ?uid=&sig= (the admin clicks the link): verifies the HMAC, sets
//       is_approved=true, and emails the user a congratulatory activation notice.
//
// Secrets (project function secrets): RESEND_API_KEY, APPROVAL_SECRET.
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APPROVAL_SECRET = Deno.env.get("APPROVAL_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ADMIN_EMAIL = "mmglobal.hq@gmail.com";
const FROM = "Core Chat <auth@mmglobal.us>";
const APP_URL = "https://chat.mmglobal.us";
const FN_URL = `${SUPABASE_URL}/functions/v1/signup-approval`;

async function sign(id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APPROVAL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) console.error("resend send failed", res.status, await res.text());
  return res.ok;
}

function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><div style="font-family:system-ui;max-width:480px;margin:64px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;text-align:center"><h1 style="font-size:18px">${title}</h1><p style="color:#6b7280;font-size:14px">${body}</p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const uid = url.searchParams.get("uid");
  if (req.method === "GET" && uid) {
    const sig = url.searchParams.get("sig") ?? "";
    if (!safeEqual(sig, await sign(uid))) return page(400, "Invalid link", "This approval link is invalid or has expired.");
    const { data: prof } = await admin.from("profiles").select("email, first_name, is_approved").eq("id", uid).maybeSingle();
    if (!prof) return page(404, "Not found", "That user no longer exists.");
    if (!prof.is_approved) {
      await admin.from("profiles").update({ is_approved: true }).eq("id", uid);
      if (prof.email) {
        await sendEmail(prof.email, "Your Core Chat account is active",
          `<p>Hi ${esc(prof.first_name) || "there"},</p><p>Your Core Chat registration has been approved — your credentials are now active.</p><p><a href="${APP_URL}">Sign in to Core Chat</a></p>`);
      }
    }
    return page(200, "Approved", `${esc(prof.email)} has been approved and notified.`);
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rid = (body as { record?: { id?: string }; id?: string }).record?.id ?? (body as { id?: string }).id;
    if (!rid) return new Response("skipped", { status: 200 });
    const { data: prof } = await admin.from("profiles")
      .select("id, first_name, last_name, username, email, is_approved, is_admin").eq("id", rid).maybeSingle();
    if (!prof || prof.is_approved || prof.is_admin) return new Response("skipped", { status: 200 });
    const link = `${FN_URL}?uid=${prof.id}&sig=${await sign(prof.id)}`;
    const name = [prof.first_name, prof.last_name].filter(Boolean).join(" ") || "(no name)";
    await sendEmail(ADMIN_EMAIL, `New Core Chat registration: ${prof.email}`,
      `<p>A new user registered and is awaiting approval:</p><ul><li><b>Name:</b> ${esc(name)}</li><li><b>Username:</b> ${esc(prof.username) || "—"}</li><li><b>Email:</b> ${esc(prof.email)}</li></ul><p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Approve this user</a></p><p style="color:#6b7280;font-size:12px">Or paste this link: ${link}</p>`);
    return new Response("notified", { status: 200 });
  }

  return new Response("ok", { status: 200 });
});
