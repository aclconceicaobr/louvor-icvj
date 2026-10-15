// Contas do Louvor ICVJ.
// - entrar: cria a conta de um membro com o código do ministério (sem e-mail de confirmação).
//   Se o ministério ainda não tem líder, quem se cadastra vira líder.
// - senha_temporaria / remover / email: ações do líder sobre outro membro (exige login de líder).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => a[x % a.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método não permitido." });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Pedido inválido." }); }
  const action = String(body.action || "");

  if (action === "entrar") {
    const name = String(body.name || "").trim().slice(0, 80);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const code = String(body.code || "").trim().toUpperCase();
    if (!name) return json(400, { error: "Informe seu nome." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "E-mail inválido." });
    if (password.length < 6) return json(400, { error: "A senha precisa ter pelo menos 6 caracteres." });
    const { data: s, error: se } = await admin.from("settings").select("invite_code").eq("id", 1).single();
    if (se || !s) return json(500, { error: "Não consegui verificar o código. Tente de novo." });
    if (code !== s.invite_code) return json(403, { error: "Código do ministério incorreto. Peça o código ao líder." });
    const { count } = await admin.from("members").select("id", { count: "exact", head: true }).eq("is_leader", true);
    const leader = (count ?? 0) === 0;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (error || !u.user) {
      const msg = /already|registered|exists/i.test(error?.message || "") ? "Este e-mail já tem conta. Use Entrar." : "Não consegui criar a conta: " + (error?.message || "erro");
      return json(409, { error: msg });
    }
    const { error: me } = await admin.from("members").insert({ id: u.user.id, name, is_leader: leader });
    if (me) { await admin.auth.admin.deleteUser(u.user.id); return json(500, { error: "Não consegui salvar seu perfil. Tente de novo." }); }
    return json(200, { ok: true, leader });
  }

  // Ações de líder
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Entre na sua conta." });
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Sessão expirada. Entre de novo." });
  const { data: lead } = await admin.from("members").select("is_leader").eq("id", who.user.id).single();
  if (!lead?.is_leader) return json(403, { error: "Apenas líderes podem fazer isso." });
  const target = String(body.member_id || "");
  if (!target) return json(400, { error: "Membro não informado." });

  if (action === "senha_temporaria") {
    const pw = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(target, { password: pw });
    if (error) return json(500, { error: "Não consegui trocar a senha." });
    const { data: t } = await admin.auth.admin.getUserById(target);
    return json(200, { ok: true, password: pw, email: t?.user?.email });
  }
  if (action === "remover") {
    if (target === who.user.id) return json(400, { error: "Você não pode remover a própria conta por aqui." });
    const { error } = await admin.auth.admin.deleteUser(target);
    if (error) return json(500, { error: "Não consegui remover o membro." });
    return json(200, { ok: true });
  }
  if (action === "email") {
    const { data: t } = await admin.auth.admin.getUserById(target);
    return json(200, { ok: true, email: t?.user?.email || "" });
  }
  return json(400, { error: "Ação desconhecida." });
});
