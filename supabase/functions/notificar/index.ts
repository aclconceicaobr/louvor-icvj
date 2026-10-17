// Notificações push do Louvor ICVJ (Web Push, funciona no Android e no iPhone com o app na tela de início).
// Ações chamadas pelo app (exigem login):
//   - escalado     { event_id, member_id }  líder: avisa quem foi escalado (só se a escala já está publicada)
//   - publicada    { event_id }             líder: avisa toda a equipe escalada
//   - indisponivel { event_id }             membro: avisa os líderes que a pessoa não pode servir
//   - aviso        { text }                 líder: avisa todos sobre um aviso novo no mural
//   - teste        {}                       qualquer membro: manda uma notificação para os próprios aparelhos
// Ação agendada (pg_cron, com o cabeçalho x-cron-secret):
//   - lembrete     {}                       véspera do culto: lembra quem está escalado amanhã
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROLE: Record<string, string> = {
  ministro: "Ministro(a)", bv1: "Backing vocal", bv2: "Backing vocal", violao: "Violão", guitarra: "Guitarra",
  teclado: "Teclado", baixo: "Baixo", bateria: "Bateria", som: "Som e mídia", projecao: "Projeção",
};
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const when = (e: { date: string; time: string }) => {
  const [y, m, d] = e.date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} às ${e.time}`;
};

let cfg: { vapid_public: string; vapid_private: string; cron_secret: string } | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await admin.rpc("push_config");
  if (error || !data?.length) throw new Error("Configuração de notificações ausente.");
  cfg = data[0];
  webpush.setVapidDetails("https://louvor-icvj.vercel.app", cfg!.vapid_public, cfg!.vapid_private);
  return cfg!;
}

type Msg = { title: string; body: string; url: string; tag?: string };
async function send(memberIds: string[], msg: Msg) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return 0;
  await config();
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("member_id", ids);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // aparelho desinstalou o app ou tirou a permissão: apaga a inscrição
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método não permitido." });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || "");

  try {
    if (action === "lembrete") {
      const c = await config();
      if (req.headers.get("x-cron-secret") !== c.cron_secret) return json(401, { error: "Não autorizado." });
      // "amanhã" no fuso de Brasília
      const now = new Date(Date.now() - 3 * 3600 * 1000);
      now.setUTCDate(now.getUTCDate() + 1);
      const tomorrow = now.toISOString().slice(0, 10);
      const { data: evs } = await admin.from("events").select("id, title, date, time").eq("date", tomorrow).eq("published", true);
      let sent = 0;
      for (const e of evs || []) {
        const { data: asg } = await admin.from("assignments").select("member_id, role_key, status").eq("event_id", e.id);
        for (const a of asg || []) {
          if (!a.member_id || a.status === "indisponivel") continue;
          sent += await send([a.member_id], { title: `Amanhã: ${e.title}`, body: `Você está em ${ROLE[a.role_key] || a.role_key}, ${when(e)}.${a.status === "pendente" ? " Confirme sua presença." : ""}`, url: `#/escala/${e.id}`, tag: `lembrete-${e.id}` });
        }
      }
      return json(200, { ok: true, sent });
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "Entre na sua conta." });
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json(401, { error: "Sessão expirada. Entre de novo." });
    const { data: me } = await admin.from("members").select("id, name, is_leader").eq("id", who.user.id).single();
    if (!me) return json(403, { error: "Você ainda não faz parte do ministério." });
    const first = String(me.name).split(" ")[0];

    if (action === "teste") {
      const sent = await send([me.id], { title: "Notificações ligadas", body: "Você vai receber avisos de escala, trocas e lembretes do culto.", url: "#/", tag: "teste" });
      return json(200, { ok: true, sent });
    }

    if (action === "indisponivel") {
      const { data: e } = await admin.from("events").select("id, title, date, time").eq("id", String(body.event_id)).single();
      if (!e) return json(404, { error: "Escala não encontrada." });
      const { data: mine } = await admin.from("assignments").select("role_key").eq("event_id", e.id).eq("member_id", me.id);
      if (!mine?.length) return json(403, { error: "Você não está nessa escala." });
      const { data: leaders } = await admin.from("members").select("id").eq("is_leader", true).neq("id", me.id);
      const sent = await send((leaders || []).map((l) => l.id), { title: `${first} não pode servir`, body: `${ROLE[mine[0].role_key] || mine[0].role_key} • ${e.title}, ${when(e)}. Toque para escolher substituto.`, url: `#/montar/${e.id}`, tag: `indisp-${e.id}-${me.id}` });
      return json(200, { ok: true, sent });
    }

    if (!me.is_leader) return json(403, { error: "Apenas líderes." });

    if (action === "escalado" || action === "publicada") {
      const { data: e } = await admin.from("events").select("id, title, date, time, published").eq("id", String(body.event_id)).single();
      if (!e) return json(404, { error: "Escala não encontrada." });
      if (!e.published) return json(200, { ok: true, sent: 0, skipped: "rascunho" });
      let q = admin.from("assignments").select("member_id, role_key").eq("event_id", e.id);
      if (action === "escalado") q = q.eq("member_id", String(body.member_id));
      const { data: asg } = await q;
      let sent = 0;
      for (const a of asg || []) {
        if (!a.member_id) continue;
        sent += await send([a.member_id], {
          title: action === "publicada" ? `Escala publicada: ${e.title}` : `Você foi escalado(a): ${e.title}`,
          body: `${ROLE[a.role_key] || a.role_key}, ${when(e)}. Toque para confirmar presença.`,
          url: `#/escala/${e.id}`, tag: `escala-${e.id}`,
        });
      }
      return json(200, { ok: true, sent });
    }

    if (action === "aviso") {
      const text = String(body.text || "").trim().slice(0, 180);
      if (!text) return json(400, { error: "Aviso vazio." });
      const { data: all } = await admin.from("members").select("id").neq("id", me.id);
      const sent = await send((all || []).map((m) => m.id), { title: `Aviso de ${first}`, body: text, url: "#/avisos", tag: "aviso" });
      return json(200, { ok: true, sent });
    }

    return json(400, { error: "Ação desconhecida." });
  } catch (e) {
    return json(500, { error: (e as Error).message || "Erro ao enviar notificação." });
  }
});
