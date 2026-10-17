/* Louvor ICVJ · webapp do Ministério de Louvor
   App de página única, sem build: rotas por hash, dados compartilhados no Supabase (login por e-mail e senha). */
(function () {
  'use strict';

  const ROLES = [
    { key: 'ministro', label: 'Ministro(a)', skill: 'ministro' },
    { key: 'bv1', label: 'Backing vocal', skill: 'vocal' },
    { key: 'bv2', label: 'Backing vocal', skill: 'vocal' },
    { key: 'violao', label: 'Violão', skill: 'violao' },
    { key: 'guitarra', label: 'Guitarra', skill: 'guitarra' },
    { key: 'teclado', label: 'Teclado', skill: 'teclado' },
    { key: 'baixo', label: 'Baixo', skill: 'baixo' },
    { key: 'bateria', label: 'Bateria', skill: 'bateria' },
    { key: 'som', label: 'Som e mídia', skill: 'som' },
    { key: 'projecao', label: 'Projeção', skill: 'projecao' },
  ];
  const SKILLS = [['ministro', 'Ministro(a)'], ['vocal', 'Vocal'], ['violao', 'Violão'], ['guitarra', 'Guitarra'], ['teclado', 'Teclado'], ['baixo', 'Baixo'], ['bateria', 'Bateria'], ['som', 'Som e mídia'], ['projecao', 'Projeção']];
  const LOGO = 'icons/logo.png';
  const CFG = window.LOUVOR_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key);
  const CACHE = 'louvor-icvj-cache-v6';

  /* ---------------- Estado (espelho do banco) ---------------- */
  let S = null;        // { meId, leader, people, songs, events, unavail, mural }
  let session = null;
  let booting = true;

  function buildState(rows) {
    const [members, songs, events, asg, unav, notices, reps] = rows;
    const prefOf = (sid) => Object.fromEntries(reps.filter((r) => r.song_id === sid).map((r) => [r.member_id, r.key]));
    const evs = events.map((e) => {
      const team = {};
      ROLES.forEach((r) => { team[r.key] = { pid: null, status: 'pendente' }; });
      asg.filter((a) => a.event_id === e.id).forEach((a) => { if (team[a.role_key]) team[a.role_key] = { pid: a.member_id, status: a.status }; });
      return { id: e.id, title: e.title, date: e.date, time: e.time, rehearsal: e.rehearsal_date ? { date: e.rehearsal_date, time: e.rehearsal_time || '16:00' } : null, published: e.published, setlist: Array.isArray(e.setlist) ? e.setlist : [], team };
    });
    const meRow = members.find((m) => m.id === session.user.id);
    return {
      meId: session.user.id,
      leader: !!(meRow && meRow.is_leader),
      people: members.map((m) => ({ id: m.id, name: m.name, ini: m.ini, photo: m.avatar_url || '', skills: m.skills || [], fem: m.fem, leader: m.is_leader })),
      songs: songs.map((s) => ({ id: s.id, title: s.title, cat: s.cat, bpm: s.bpm, key: s.key, sig: s.sig, chart: s.chart, media: s.media_url || '', pref: prefOf(s.id) })),
      rep: reps.map((r) => ({ pid: r.member_id, songId: r.song_id, key: r.key, at: r.created_at })),
      events: evs,
      unavail: unav.map((u) => ({ id: u.id, pid: u.member_id, from: u.from_date, to: u.to_date, reason: u.reason, auto: u.event_id })),
      mural: notices.map((n) => ({ id: n.id, text: n.text, author: n.author_name || 'Líder do louvor', at: Date.parse(n.created_at) })),
    };
  }
  async function fetchAll() {
    const q = (p) => p.then((r) => { if (r.error) throw r.error; return r.data; });
    const since = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return iso(d); })();
    const rows = await Promise.all([
      q(sb.from('members').select('*').order('name')),
      q(sb.from('songs').select('*')),
      q(sb.from('events').select('*').gte('date', since).order('date')),
      q(sb.from('assignments').select('*')),
      q(sb.from('unavailability').select('*').gte('to_date', since)),
      q(sb.from('notices').select('*').order('created_at', { ascending: false }).limit(60)),
      q(sb.from('repertoire').select('*')),
    ]);
    S = buildState(rows);
    try { localStorage.setItem(CACHE, JSON.stringify({ uid: session.user.id, S })); } catch (e) { /* sem cache */ }
  }
  async function reload() {
    try { await fetchAll(); } catch (e) { toast(errMsg(e)); return; }
    if (!document.querySelector('.sheet')) rerender();
  }
  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.error)) || String(e);
    if (/fetch|network|Failed to/i.test(m) || !navigator.onLine) return 'Sem conexão com a internet. Tente de novo.';
    if (/row-level security|permission/i.test(m)) return 'Você não tem permissão para isso.';
    return m;
  }
  // Executa uma alteração no banco, mostra o resultado e recarrega os dados.
  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (r && r.error) throw r.error;
      if (okMsg) toast(okMsg);
      await reload();
      return true;
    } catch (e) { toast(errMsg(e)); return false; }
  }
  const must = (p) => p.then((r) => { if (r.error) throw r.error; return r; });

  const person = (id) => S.people.find((p) => p.id === id);
  const song = (id) => S.songs.find((s) => s.id === id);
  const event = (id) => S.events.find((e) => e.id === id);
  const me = () => person(S.meId);
  // Repertório: músicas que cada ministro canta, com o tom dele
  const repOf = (pid) => (S.rep || []).filter((r) => r.pid === pid && song(r.songId));
  const ministers = () => S.people.filter((p) => p.skills.includes('ministro') || repOf(p.id).length);
  const sings = (p) => p.skills.some((x) => x === 'vocal' || x === 'ministro');
  const canEditRep = (pid) => pid === S.meId || S.leader;
  const first = (p) => (p ? p.name.split(' ')[0] : '—');
  const initials = (p) => p.ini || p.name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const roleLabel = (r, p) => (r.key === 'ministro' && p ? (p.fem ? 'Ministra' : 'Ministro') : r.label);
  const roleDef = (k) => ROLES.find((r) => r.key === k);

  /* ---------------- Datas ---------------- */
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WDL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MOL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => iso(new Date());
  const fmtShort = (s) => { const d = parse(s); return `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}`; };
  const fmtLong = (s) => { const d = parse(s); return `${WDL[d.getDay()]}, ${d.getDate()} de ${MOL[d.getMonth()].toLowerCase()}`; };
  const fmtNum = (s) => { const d = parse(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const hourShort = (t) => (t.endsWith(':00') ? String(parseInt(t, 10)) + 'h' : t.replace(':', 'h'));
  function daysAgo(s) {
    const n = Math.round((parse(todayISO()) - parse(s)) / 864e5);
    if (n <= 0) return 'hoje';
    if (n < 7) return `há ${n} dia${n > 1 ? 's' : ''}`;
    if (n < 30) { const w = Math.round(n / 7); return `há ${w} semana${w > 1 ? 's' : ''}`; }
    const m = Math.round(n / 30); return `há ${m} ${m > 1 ? 'meses' : 'mês'}`;
  }
  function ago(ts) {
    const h = Math.floor((Date.now() - ts) / 3600e3);
    if (h < 1) return 'agora';
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24); return `há ${d} dia${d > 1 ? 's' : ''}`;
  }

  /* ---------------- Regras ---------------- */
  const upcoming = () => S.events.filter((e) => e.date >= todayISO()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const isUnavail = (pid, date) => S.unavail.some((u) => u.pid === pid && u.from <= date && date <= u.to);
  const myRole = (e, pid = S.meId) => Object.keys(e.team).find((k) => e.team[k].pid === pid);
  const filled = (e) => ROLES.filter((r) => e.team[r.key].pid).length;
  const monthCount = (pid, date) => {
    const ym = date.slice(0, 7);
    return S.events.filter((e) => e.date.slice(0, 7) === ym && Object.values(e.team).some((t) => t.pid === pid)).length;
  };
  function stats(e) {
    const t = Object.values(e.team).filter((x) => x.pid);
    return {
      ok: t.filter((x) => x.status === 'confirmado').length,
      pend: t.filter((x) => x.status === 'pendente').length,
      alert: t.filter((x) => x.status === 'indisponivel' || x.status === 'troca').length,
    };
  }
  function alerts(e) {
    const out = [];
    for (const r of ROLES) {
      const slot = e.team[r.key];
      if (!slot.pid) continue;
      if (slot.status === 'indisponivel' || isUnavail(slot.pid, e.date)) {
        const sug = suggest(e, r.key, slot.pid);
        out.push({ role: r.key, pid: slot.pid, sug });
      }
    }
    return out;
  }
  function suggest(e, roleKey, exclude) {
    const skill = roleDef(roleKey).skill;
    const used = new Set(Object.values(e.team).map((t) => t.pid));
    return S.people
      .filter((p) => p.id !== exclude && p.skills.includes(skill) && !used.has(p.id) && !isUnavail(p.id, e.date))
      .sort((a, b) => monthCount(a.id, e.date) - monthCount(b.id, e.date))[0];
  }
  function lastPlayed(songId) {
    const past = S.events.filter((e) => e.date < todayISO() && e.setlist.some((x) => x.songId === songId)).map((e) => e.date).sort();
    if (past.length) return 'Tocada ' + daysAgo(past[past.length - 1]);
    const next = upcoming().find((e) => e.setlist.some((x) => x.songId === songId));
    if (next) return next.date === todayISO() ? 'No culto de hoje' : 'Próxima: ' + fmtShort(next.date).toLowerCase();
    return 'Nunca tocada';
  }

  /* ---------------- Transposição ---------------- */
  const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
  const noteIdx = (n) => { const i = SH.indexOf(n); return i >= 0 ? i : FL.indexOf(n); };
  const shift = (n, st, flat) => { const i = noteIdx(n); return i < 0 ? n : (flat ? FL : SH)[(i + st + 120) % 12]; };
  const CHORD = /^([A-G][#b]?)((?:m|maj|min|dim|aug|sus|add|[0-9]|\+|°|º|\(|\)|M)*)(?:\/([A-G][#b]?))?$/;
  const isChord = (tok) => CHORD.test(tok);
  const trChord = (c, st, flat) => c.replace(CHORD, (m, r, q, b) => shift(r, st, flat) + q + (b ? '/' + shift(b, st, flat) : ''));
  const semis = (from, to) => (noteIdx(to) - noteIdx(from) + 12) % 12;
  const ALL_KEYS = SH.map((k, i) => (FLAT_KEYS.includes(FL[i]) ? FL[i] : k));
  const keyStep = (k, d) => { const n = (noteIdx(k) + d + 12) % 12; return FLAT_KEYS.includes(FL[n]) ? FL[n] : SH[n]; };

  function transposeLine(line, st, flat) {
    let out = '';
    line.replace(/\S+/g, (tok, pos) => {
      const c = trChord(tok, st, flat);
      const at = Math.max(pos, out.length ? out.length + 1 : 0);
      out = out.padEnd(at, ' ') + c;
      return tok;
    });
    return out;
  }
  function renderChart(chart, fromKey, toKey) {
    const st = semis(fromKey, toKey);
    const flat = FLAT_KEYS.includes(toKey);
    return chart.split('\n').map((raw) => {
      const line = raw.replace(/\s+$/, '');
      const sec = line.match(/^\[(.+)\]$/);
      if (sec) return `<div class="sect">${esc(sec[1])}</div>`;
      const intro = line.match(/^(Intro|Final|Solo|Interlúdio):\s*(.*)$/i);
      if (intro) return `<div class="ln intro">${esc(intro[1])}:  ${esc(intro[2].split(/\s+/).map((c) => trChord(c, st, flat)).join('  '))}</div>`;
      const toks = line.trim().split(/\s+/).filter(Boolean);
      if (toks.length && toks.every(isChord)) return `<div class="ln ch">${esc(transposeLine(line, st, flat))}</div>`;
      return `<div class="ln">${esc(line)}</div>`;
    }).join('');
  }

  /* ---------------- Utilidades de UI ---------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    calx: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M10 13.5l4 4M14 13.5l-4 4"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mega: '<path d="M3 10v4a1 1 0 0 0 1 1h3l8 5V4L7 9H4a1 1 0 0 0-1 1z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    play: '<path d="M7 4v16l13-8z" fill="currentColor"/>', pause: '<path d="M9 5v14M15 5v14"/>',
    prev: '<path d="M19 20 9 12l10-8zM5 19V5"/>', next: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  };
  const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const STATUS = {
    confirmado: [ic('check', 'xs'), 'Confirmado'],
    pendente: [ic('clock', 'xs'), 'Pendente'],
    indisponivel: [ic('x', 'xs'), 'Indisponível'],
    troca: [ic('swap', 'xs'), 'Troca solicitada'],
  };
  const pill = (st) => `<span class="pill ${st}">${STATUS[st][0]}${STATUS[st][1]}</span>`;
  const avatar = (p, cls = '') => `<span class="avatar ${cls}">${p && p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : p ? esc(initials(p)) : '?'}</span>`;
  const datebox = (s, on) => { const d = parse(s); return `<span class="datebox ${on ? 'on' : ''}"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></span>`; };
  const back = (to) => `<button class="iconbtn" data-go="${to}" aria-label="Voltar">${ic('left')}</button>`;

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function sheet(html, mount) {
    closeSheet();
    const root = document.getElementById('sheet-root');
    root.innerHTML = `<div class="sheet-back" data-sheet-back><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const el = root.querySelector('.sheet');
    if (mount) mount(el);
    const f = el.querySelector('input, select, textarea, button');
    if (f && f.matches('input, textarea')) setTimeout(() => f.focus(), 50);
  }
  function closeSheet() { document.getElementById('sheet-root').innerHTML = ''; }

  /* ---------------- Instalar na tela inicial ---------------- */
  const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let installEvt = null;
  let installHidden = (() => { try { return localStorage.getItem('louvor-install-hidden') === '1'; } catch (e) { return false; } })();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!document.querySelector('.sheet')) rerender(); });
  window.addEventListener('appinstalled', () => { installEvt = null; installHidden = true; rerender(); });
  function installCard() {
    if (STANDALONE || installHidden) return '';
    const close = `<button class="install-x" data-act="hideInstall" aria-label="Fechar">${ic('x', 'sm')}</button>`;
    if (IS_IOS) {
      return `<div class="install"><img src="icons/apple-touch-icon.png" alt="" width="44" height="44"><div class="grow"><b>Instale o app no iPhone</b>
        <p>No Safari, toque em <span class="kbd">${ic('share', 'xs')}</span> Compartilhar (se não aparecer, toque nos <b>•••</b> primeiro), depois em <b>Adicionar à Tela de Início</b> e em <b>Adicionar</b>.</p>
        <p class="s">Ao abrir pelo ícone, entre de novo com seu e-mail e senha: o iPhone separa o app do Safari.</p></div>${close}</div>`;
    }
    if (installEvt) {
      return `<div class="install"><img src="icons/icon-192.png" alt="" width="44" height="44"><div class="grow"><b>Instale o app</b><p>Fica na tela inicial e abre em tela cheia.</p>
        <button class="btn primary" style="height:40px;margin-top:6px" data-act="install">Instalar</button></div>${close}</div>`;
    }
    return '';
  }

  /* ---------------- Telas ---------------- */
  const views = {};

  views.inicio = () => {
    const u = me();
    const h = new Date().getHours();
    const greet = h < 12 ? 'Bom dia,' : h < 18 ? 'Boa tarde,' : 'Boa noite,';
    const mine = upcoming().filter((e) => e.published && myRole(e));
    const nx = mine[0];
    let hero = `<section class="hero"><div class="eyebrow">Sua próxima escala</div><h2>Nenhuma escala por enquanto</h2><div class="when">Quando o líder publicar uma escala com você, ela aparece aqui.</div></section>`;
    if (nx) {
      const rk = myRole(nx), slot = nx.team[rk];
      const reh = nx.rehearsal ? `Ensaio: ${fmtShort(nx.rehearsal.date).toLowerCase()} • ${nx.rehearsal.time}` : 'Sem ensaio marcado';
      let actions;
      if (slot.status === 'confirmado') actions = `<div class="done"><span>${ic('check', 'sm')} Presença confirmada</span><button data-act="setMine" data-ev="${nx.id}" data-st="pendente">Desfazer</button></div>`;
      else if (slot.status === 'indisponivel') actions = `<div class="done"><span>${ic('x', 'sm')} Você avisou que não pode</span><button data-act="setMine" data-ev="${nx.id}" data-st="pendente">Desfazer</button></div>`;
      else actions = `<div class="btn-row"><button class="btn on-light" data-act="setMine" data-ev="${nx.id}" data-st="confirmado">${ic('check', 'sm')} Confirmar</button><button class="btn on-dark" data-act="cantGo" data-ev="${nx.id}">Não posso</button></div>`;
      hero = `<section class="hero">
        <div class="eyebrow">Sua próxima escala</div>
        <h2 data-go="#/escala/${nx.id}" style="cursor:pointer">${esc(nx.title)}</h2>
        <div class="when">${ic('clock', 'sm')} ${fmtLong(nx.date).replace(/ de (\w+)$/, (m, mo) => ' ' + mo.slice(0, 3))} • ${nx.time}</div>
        <div class="role">${ic('mic', 'sm')}<div><b>${esc(roleDef(rk).label)}</b><small>${esc(reh)}</small></div></div>
        ${actions}
      </section>`;
    }
    const week = upcoming().filter((e) => e.published && e.date <= iso(new Date(Date.now() + 7 * 864e5))).slice(0, 5);
    const weekRows = week.map((e) => {
      const r = myRole(e);
      return `<button class="row" data-go="#/escala/${e.id}">${datebox(e.date, !!r)}<div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${e.time} • ${r ? esc(roleDef(r).label) : filled(e) + ' na equipe'}</div></div>${r ? '<span class="count">Você</span>' : `<span class="chev">${ic('right', 'sm')}</span>`}</button>`;
    }).join('');
    const m = S.mural[0];
    return `
      <header class="top"><div class="grow"><div class="sub" style="margin:0">${greet}</div><h1 style="font-size:24px">${esc(first(u))}</h1></div>
        <button class="iconbtn round" data-go="#/avisos" aria-label="Avisos">${ic('bell')}</button>
        <button data-go="#/perfil" aria-label="Perfil">${avatar(u)}</button></header>
      ${installCard()}
      ${hero}
      ${u.skills.length ? '' : `<button class="card row" data-go="#/perfil"><span class="ic-box" style="background:var(--brand-soft);color:var(--brand)">${ic('mic', 'sm')}</span><div class="grow"><div class="t">Marque suas funções</div><div class="s">Assim o líder consegue te escalar</div></div><span class="chev">${ic('right', 'sm')}</span></button>`}
      <section class="sec"><div class="sec-h"><h2>Esta semana</h2><a class="link" href="#/escalas">Ver escalas</a></div>
        ${weekRows ? `<div class="list">${weekRows}</div>` : '<div class="card empty-state">Nada marcado para os próximos 7 dias.</div>'}</section>
      <section class="sec"><div class="sec-h"><h2>Mural</h2><a class="link" href="#/avisos">Ver todos</a></div>
        ${m ? `<div class="mural"><span class="ic">${ic('mega', 'sm')}</span><div><p>${esc(m.text)}</p><small>${esc(m.author)} • ${ago(m.at)}</small></div></div>` : '<div class="card empty-state">Nenhum aviso.</div>'}</section>`;
  };

  views.escalas = () => {
    const list = upcoming();
    const rows = list.map((e) => {
      const r = myRole(e);
      const sub = `${e.time} • ${filled(e)} de ${ROLES.length} funções${r ? ' • você: ' + roleDef(r).label.toLowerCase() : ''}`;
      return `<button class="row" data-go="#/escala/${e.id}">${datebox(e.date, !!r)}<div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(sub)}</div></div>${e.published ? '' : '<span class="count">Rascunho</span>'}<span class="chev">${ic('right', 'sm')}</span></button>`;
    }).join('');
    return `
      <header class="top big"><div class="grow"><h1>Escalas</h1><div class="sub">Próximos cultos e reuniões</div></div>
        ${S.leader ? `<button class="iconbtn fill" data-act="newEvent" aria-label="Nova escala">${ic('plus')}</button>` : ''}</header>
      <button class="card row" data-go="#/disponibilidade"><span class="ic-box">${ic('calx', 'sm')}</span><div class="grow"><div class="t">Minha disponibilidade</div><div class="s">Marque os dias em que não pode servir</div></div><span class="chev">${ic('right', 'sm')}</span></button>
      <section class="sec">${rows ? `<div class="list">${rows}</div>` : '<div class="card empty-state">Nenhuma escala futura.</div>'}</section>`;
  };

  views.escala = (id) => {
    const e = event(id);
    if (!e) return notFound();
    const st = stats(e);
    const team = ROLES.filter((r) => e.team[r.key].pid).map((r) => {
      const p = person(e.team[r.key].pid);
      return `<div class="row">${avatar(p)}<div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(roleLabel(r, p))}</div></div>${pill(e.team[r.key].status)}</div>`;
    }).join('');
    const reps = e.setlist.map((x, i) => {
      const s = song(x.songId);
      return `<button class="row" data-go="#/cifra/${s.id}/${enc(x.key)}/${e.id}"><span class="num">${pad(i + 1)}</span><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">Ministra: ${esc(person(x.lead) ? person(x.lead).name : '—')}</div></div><span class="key">Tom ${esc(x.key)}</span></button>`;
    }).join('');
    const mine = myRole(e);
    return `
      <header class="top">${back('#/escalas')}<div class="grow"><h1>${esc(e.title)}</h1><div class="sub">${fmtLong(e.date)} • ${e.time}</div></div>
        <button class="iconbtn" data-act="eventMenu" data-ev="${e.id}" aria-label="Mais opções">${ic('more')}</button></header>
      ${e.published ? '' : '<div class="note">Rascunho: a equipe ainda não foi avisada. Publique em “Montar escala”.</div>'}
      <div class="stats"><div class="stat ok"><b>${st.ok}</b><span>confirmados</span></div><div class="stat"><b>${st.pend}</b><span>pendentes</span></div><div class="stat ${st.alert ? 'bad' : ''}"><b>${st.alert}</b><span>alerta${st.alert === 1 ? '' : 's'}</span></div></div>
      ${mine && e.published && e.team[mine].status === 'pendente' ? `<div class="btn-row"><button class="btn primary" data-act="setMine" data-ev="${e.id}" data-st="confirmado">${ic('check', 'sm')} Confirmar</button><button class="btn outline" data-act="cantGo" data-ev="${e.id}">Não posso</button></div>` : ''}
      <section class="sec"><div class="sec-h"><h2>Equipe</h2>${S.leader ? `<a class="link" href="#/montar/${e.id}">Editar</a>` : ''}</div>
        ${team ? `<div class="list">${team}</div>` : '<div class="card empty-state">Ninguém escalado ainda.</div>'}</section>
      <section class="sec"><div class="sec-h"><h2>Repertório</h2><span class="link">${e.setlist.length} música${e.setlist.length === 1 ? '' : 's'}</span></div>
        ${reps ? `<div class="list">${reps}</div>` : '<div class="card empty-state">Repertório ainda não definido.</div>'}</section>
      ${e.setlist.length ? `<button class="btn ghost block" data-go="#/palco/${e.setlist[0].songId}/${enc(e.setlist[0].key)}/${e.id}">${ic('expand', 'sm')} Abrir repertório no modo palco</button>` : ''}
      <button class="btn whats block" data-go="#/compartilhar/${e.id}">${ic('chat', 'sm')} Compartilhar no WhatsApp</button>`;
  };

  views.montar = (id) => {
    const evs = upcoming();
    const e = event(id) || evs[0];
    if (!e) return notFound();
    const al = alerts(e);
    const alertHtml = al.map((a) => {
      const p = person(a.pid);
      const s = a.sug;
      return `<div class="alertbox"><div class="h">${ic('alert', 'sm')} ${esc(first(p))} marcou indisponível em ${fmtNum(e.date)}</div>
        ${s ? `<p>Sugestão: ${esc(s.name)}, que serviu ${monthCount(s.id, e.date)}× este mês.</p><button data-act="assign" data-ev="${e.id}" data-role="${a.role}" data-pid="${s.id}">Trocar por ${esc(first(s))}</button>` : '<p>Ninguém livre com essa função nesta data.</p>'}</div>`;
    }).join('');
    const rows = ROLES.map((r) => {
      const slot = e.team[r.key];
      const p = person(slot.pid);
      if (!p) return `<button class="row empty" data-act="pick" data-ev="${e.id}" data-role="${r.key}"><span class="avatar" style="background:transparent;border:1.5px dashed var(--accent)">${ic('plus', 'sm')}</span><div class="grow"><div class="eyebrow">${esc(r.label)}</div><div class="t" style="color:var(--brand)">Escolher pessoa</div></div></button>`;
      const bad = slot.status === 'indisponivel' || isUnavail(p.id, e.date);
      return `<button class="row ${bad ? 'warn' : ''}" data-act="pick" data-ev="${e.id}" data-role="${r.key}">${avatar(p)}<div class="grow"><div class="eyebrow">${esc(r.label)}</div><div class="t">${esc(p.name)}</div></div>${bad ? pill('indisponivel') : `<span class="count">${monthCount(p.id, e.date)}× no mês</span>`}</button>`;
    }).join('');
    const reps = e.setlist.map((x, i) => {
      const s = song(x.songId);
      return `<div class="row"><span class="num">${pad(i + 1)}</span><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${esc(person(x.lead) ? person(x.lead).name : '—')}</div></div><span class="key">Tom ${esc(x.key)}</span><button class="iconbtn" style="width:34px;height:34px" data-act="rmSong" data-ev="${e.id}" data-i="${i}" aria-label="Remover ${esc(s.title)}">${ic('x', 'sm')}</button></div>`;
    }).join('');
    const opts = evs.map((x) => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${esc(x.title)} · ${fmtNum(x.date)} ${x.time}</option>`).join('');
    return `
      <header class="top">${back('#/escala/' + e.id)}<div class="grow"><h1>Montar escala</h1></div><span class="tag">Líder</span></header>
      <div class="card select-card"><div class="grow"><div class="lbl">Culto</div><div class="t" style="font-weight:600">${esc(e.title)}</div><div class="s" style="font-size:13px;color:var(--muted)">${fmtShort(e.date)} • ${e.time}</div></div>${ic('down')}
        <select id="pick-event" aria-label="Escolher culto" data-act-change="switchEvent">${opts}</select></div>
      ${alertHtml}
      <section class="sec"><div class="sec-h"><h2>Funções</h2><span class="link">${filled(e)} de ${ROLES.length} preenchidas</span></div><div class="rows-sep">${rows}</div></section>
      <section class="sec"><div class="sec-h"><h2>Repertório</h2><button class="link" data-act="addSong" data-ev="${e.id}">+ Adicionar</button></div>
        ${reps ? `<div class="list">${reps}</div>` : `<button class="card empty-state" data-act="addSong" data-ev="${e.id}">Nenhuma música ainda. Toque para adicionar.</button>`}</section>
      <div class="btn-row"><button class="btn outline" data-act="draft" data-ev="${e.id}">Rascunho</button><button class="btn primary" data-act="publish" data-ev="${e.id}">${ic('bell', 'sm')} Publicar e avisar</button></div>`;
  };

  let calCursor = null;
  views.disponibilidade = () => {
    const today = todayISO();
    if (!calCursor) { const d = new Date(); calCursor = new Date(d.getFullYear(), d.getMonth(), 1); }
    const y = calCursor.getFullYear(), mo = calCursor.getMonth();
    const startPad = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    let cells = 'DSTQQSS'.split('').map((c) => `<div class="wd">${c}</div>`).join('');
    for (let i = 0; i < startPad; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const ds = iso(new Date(y, mo, d));
      const hasEv = S.events.some((e) => e.date === ds);
      const esc_ = S.events.some((e) => e.date === ds && e.published && myRole(e));
      const off = isUnavail(S.meId, ds);
      const cls = [off ? 'off' : esc_ ? 'esc' : '', ds === today ? 'today' : '', ds < today && !off && !esc_ ? 'past' : ''].join(' ');
      const label = `${d} de ${MOL[mo].toLowerCase()}${off ? ', indisponível' : esc_ ? ', escalado' : ''}${hasEv ? ', dia de culto' : ''}`;
      cells += `<button class="day ${cls}" data-act="day" data-d="${ds}" ${ds < today ? 'disabled' : ''} aria-label="${label}">${d}${hasEv ? '<i class="dot"></i>' : ''}</button>`;
    }
    const mine = S.unavail.filter((u) => u.pid === S.meId && u.to >= today).sort((a, b) => a.from.localeCompare(b.from));
    const rows = mine.map((u) => `<div class="row"><span class="ic-box">${ic('calx', 'sm')}</span><div class="grow"><div class="t">${u.from === u.to ? fmtShort(u.from) : fmtShort(u.from) + ' – ' + fmtShort(u.to)}</div><div class="s">${esc(u.reason || 'Sem motivo informado')}</div></div><button class="iconbtn" style="border:0" data-act="rmOff" data-id="${u.id}" aria-label="Remover">${ic('x', 'sm')}</button></div>`).join('');
    return `
      <header class="top">${back('#/escalas')}<div class="grow"><h1>Minha disponibilidade</h1><div class="sub">Toque num dia para marcar que não pode servir</div></div></header>
      <div class="card cal"><div class="cal-h"><button data-act="cal" data-d="-1" aria-label="Mês anterior">${ic('left', 'sm')}</button><b>${MOL[mo]} ${y}</b><button data-act="cal" data-d="1" aria-label="Próximo mês">${ic('right', 'sm')}</button></div>
        <div class="cal-grid">${cells}</div>
        <div class="legend"><span><i style="background:var(--brand)"></i>Escalado</span><span><i style="background:var(--danger-soft);box-shadow:inset 0 0 0 1px var(--danger)"></i>Indisponível</span><span><i style="background:var(--brand-soft)"></i>• Dia de culto</span></div></div>
      <section class="sec"><div class="sec-h"><h2>Indisponibilidades</h2><span class="link">${mine.length} marcada${mine.length === 1 ? '' : 's'}</span></div>
        ${rows ? `<div class="list">${rows}</div>` : '<div class="card empty-state">Você está disponível em todas as datas.</div>'}</section>
      <button class="btn outline block" data-act="addOff">${ic('plus', 'sm')} Adicionar período</button>`;
  };

  let songQuery = '', songCat = 'Todas';
  views.musicas = () => {
    const cats = ['Todas', ...Array.from(new Set(S.songs.map((s) => s.cat)))];
    const q = songQuery.trim().toLowerCase();
    const list = S.songs.filter((s) => (songCat === 'Todas' || s.cat === songCat) && (!q || (s.title + ' ' + s.chart + ' ' + s.key).toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    const rows = list.map((s) => `<button class="row" data-go="#/cifra/${s.id}"><span class="song-ic">${ic('music', 'sm')}</span><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.cat)} • ${s.bpm} BPM</div><div class="s">${esc(lastPlayed(s.id))}</div></div><span class="tom"><span>TOM</span><b>${esc(s.key)}</b></span></button>`).join('');
    return `
      <header class="top big"><div class="grow"><h1>Músicas</h1><div class="sub">${S.songs.length} no repertório da igreja</div></div>
        <button class="iconbtn fill" data-act="newSong" aria-label="Nova música">${ic('plus')}</button></header>
      ${minStrip()}
      <label class="search">${ic('search', 'sm')}<input id="song-q" type="search" placeholder="Buscar por título, tom ou trecho" value="${esc(songQuery)}" autocomplete="off"></label>
      <div class="chips" role="tablist">${cats.map((c) => `<button class="chip ${c === songCat ? 'on' : ''}" data-act="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="rows-sep" id="song-list">${rows || '<div class="card empty-state">Nenhuma música encontrada.</div>'}</div>`;
  };

  const minStrip = () => {
    const ms = ministers();
    if (!ms.length) return '';
    return `<section class="sec"><div class="sec-h"><h2>Repertório por ministro</h2></div>
      <div class="min-strip">${ms.map((p) => { const n = repOf(p.id).length; return `<button class="min-card" data-go="#/repertorio/${p.id}">${avatar(p)}<b>${esc(first(p))}${p.id === S.meId ? ' (você)' : ''}</b><span>${n} música${n === 1 ? '' : 's'}</span></button>`; }).join('')}</div></section>`;
  };

  views.repertorio = (pid) => {
    const p = person(pid);
    if (!p) return notFound();
    const list = repOf(pid).sort((a, b) => song(a.songId).title.localeCompare(song(b.songId).title, 'pt'));
    const edit = canEditRep(pid);
    const rows = list.map((r) => { const s = song(r.songId); return `<div class="row"><button class="row-main" data-go="#/cifra/${s.id}/${enc(r.key)}"><span class="song-ic">${ic('music', 'sm')}</span><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.cat)} • ${s.bpm} BPM${r.key !== s.key ? ' • original em ' + esc(s.key) : ''}</div></div><span class="tom"><span>TOM</span><b>${esc(r.key)}</b></span></button>${edit ? `<button class="iconbtn" data-act="repEdit" data-pid="${pid}" data-song="${s.id}" aria-label="Mudar tom ou tirar">${ic('more', 'sm')}</button>` : ''}</div>`; }).join('');
    const title = pid === S.meId ? 'Meu repertório' : 'Repertório de ' + first(p);
    return `
      <header class="top">${back('#/musicas')}<div class="grow"><h1>${esc(title)}</h1><div class="sub">${esc(p.name)} • ${list.length} música${list.length === 1 ? '' : 's'}</div></div></header>
      ${edit || list.length ? `<div class="btn-row">${edit ? `<button class="btn primary" data-act="repAdd" data-pid="${pid}">${ic('plus', 'sm')} Adicionar música</button>` : ''}${list.length ? `<a class="btn whats" href="https://wa.me/?text=${encodeURIComponent(repText(p, list))}" target="_blank" rel="noopener">${ic('chat', 'sm')} Enviar</a>` : ''}</div>` : ''}
      <div class="rows-sep">${rows || `<div class="card empty-state">${edit ? 'Nenhuma música ainda. Toque em Adicionar música, ou abra uma cifra e salve o seu tom.' : esc(first(p)) + ' ainda não montou o repertório.'}</div>`}</div>`;
  };
  const repText = (p, list) => `*Repertório de ${p.name}*\n\n` + list.map((r) => `• ${song(r.songId).title} (${r.key})`).join('\n');

  // Vídeo ou áudio da música, tocado dentro do app
  function mediaEmbed(url) {
    if (!url) return null;
    let u; try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let yt = null;
    if (host === 'youtu.be') yt = u.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
    if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'video', src: `https://www.youtube-nocookie.com/embed/${yt}?playsinline=1&rel=0` };
    const sp = host === 'open.spotify.com' && u.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode)\/(\w+)/);
    if (sp) return { kind: 'spotify', src: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`, h: sp[1] === 'track' || sp[1] === 'episode' ? 152 : 352 };
    if (/\.(mp3|m4a|aac|ogg|wav)$/i.test(u.pathname)) return { kind: 'audio', src: url };
    return null;
  }
  // O player fica fora da tela atual: continua tocando enquanto a pessoa navega pelo app
  let listenOpen = null;
  const embedHtml = (m) => m.kind === 'video' ? `<div class="pl-media video"><iframe src="${esc(m.src)}&autoplay=1" title="Vídeo da música" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : m.kind === 'spotify' ? `<div class="pl-media"><iframe src="${esc(m.src)}" title="Áudio da música" height="${m.h}" allow="autoplay; encrypted-media; clipboard-write"></iframe></div>`
    : `<div class="pl-media"><audio controls autoplay src="${esc(m.src)}"></audio></div>`;
  function setPlayer(s) {
    const root = document.getElementById('player');
    listenOpen = s ? s.id : null;
    if (!s) { root.innerHTML = ''; root.hidden = true; document.body.classList.remove('has-player'); return; }
    root.innerHTML = `<div class="pl-bar"><span class="song-ic">${ic('music', 'sm')}</span><button class="grow pl-title" data-go="#/cifra/${s.id}">${esc(s.title)}</button>
      <button class="iconbtn" data-act="playerMin" aria-label="Minimizar">${ic('minus', 'sm')}</button><button class="iconbtn" data-act="playerClose" aria-label="Fechar">${ic('x', 'sm')}</button></div>${embedHtml(mediaEmbed(s.media))}`;
    root.hidden = false; root.classList.remove('min'); document.body.classList.add('has-player'); sizePlayer();
  }
  function sizePlayer() { const r = document.getElementById('player'); document.documentElement.style.setProperty('--player-h', (r.hidden ? 0 : r.offsetHeight) + 'px'); }

  views.cifra = (id, key, evId) => {
    const s = song(id);
    if (!s) return notFound();
    const k = key ? dec(key) : s.key;
    const e = evId ? event(evId) : null;
    const chips = Object.entries(s.pref || {}).map(([pid, pk]) => {
      const p = person(pid); if (!p) return '';
      return `<button class="chip soft ${pk === k ? 'on' : ''}" data-go="#/cifra/${s.id}/${enc(pk)}${e ? '/' + e.id : ''}">${esc(first(p))} • ${esc(pk)}</button>`;
    }).join('');
    const yt = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(s.title + ' louvor');
    return `
      <header class="top">${back(e ? '#/escala/' + e.id : '#/musicas')}<div class="grow"><h1>${esc(s.title)}</h1><div class="sub">${esc(s.cat)} • ${s.bpm} BPM • ${esc(s.sig)}</div></div>
        <button class="iconbtn" data-act="songMenu" data-song="${s.id}" aria-label="Mais opções">${ic('more')}</button></header>
      <div class="card keybar"><div class="line"><div><div class="lbl">Tom</div><div class="s" style="font-size:13px;color:var(--muted)">Original: ${esc(s.key)}</div></div>
        <div class="stepper"><button data-go="#/cifra/${s.id}/${enc(keyStep(k, -1))}${e ? '/' + e.id : ''}" aria-label="Meio tom abaixo">${ic('minus', 'sm')}</button><b>${esc(k)}</b><button data-go="#/cifra/${s.id}/${enc(keyStep(k, 1))}${e ? '/' + e.id : ''}" aria-label="Meio tom acima">${ic('plus', 'sm')}</button></div></div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        ${s.pref[S.meId] !== k && (sings(me()) || s.pref[S.meId]) ? `<button class="link" style="align-self:flex-start;color:var(--brand);font-weight:600;font-size:13px" data-act="myKey" data-song="${s.id}" data-k="${esc(k)}">${s.pref[S.meId] ? `Salvar ${esc(k)} como meu tom` : `Adicionar ao meu repertório em ${esc(k)}`}</button>` : ''}</div>
      <div class="btn-row"><button class="btn primary" data-go="#/palco/${s.id}/${enc(k)}${e ? '/' + e.id : ''}">${ic('expand', 'sm')} Modo palco</button>${listenBtn(s, yt)}</div>
      <div class="card sheet-music">${renderChart(s.chart, s.key, k)}</div>
      <p class="fine">Letra e cifra ilustrativas, cadastradas como exemplo.</p>`;
  };

  const listenBtn = (s, yt) => {
    const m = mediaEmbed(s.media);
    if (m) return `<button class="btn ghost" data-act="listen" data-song="${s.id}">${ic(listenOpen === s.id ? 'pause' : 'play', 'sm')} ${listenOpen === s.id ? 'Parar' : 'Ouvir'}</button>`;
    if (s.media) return `<a class="btn ghost" href="${esc(s.media)}" target="_blank" rel="noopener">${ic('play', 'sm')} Ouvir</a>`;
    return `<button class="btn ghost" data-act="addMedia" data-song="${s.id}">${ic('play', 'sm')} Ouvir</button>`;
  };

  /* Modo palco */
  let stage = null;
  const fmtSpeed = (v) => v.toFixed(2).replace(/0$/, '').replace('.', ',') + '×';
  views.palco = (id, key, evId) => {
    const s = song(id);
    if (!s) return notFound();
    const k = key ? dec(key) : s.key;
    const e = evId ? event(evId) : null;
    const idx = e ? e.setlist.findIndex((x) => x.songId === id) : -1;
    const nxt = e && idx >= 0 ? e.setlist[idx + 1] : null;
    const prv = e && idx > 0 ? e.setlist[idx - 1] : null;
    const prefs = stage || { size: 1, light: false, speed: 1, playing: false };
    stage = prefs;
    const sizes = [18, 22, 27, 33];
    return `<div class="stage-wrap ${prefs.light ? 'light' : ''}" id="stage">
      <div class="head"><div class="grow"><small>${e && idx >= 0 ? `${idx + 1} DE ${e.setlist.length} • ` : ''}TOM ${esc(k)}</small><h1>${esc(s.title)}</h1></div>
        <button class="stage-btn" data-act="stageSize" aria-label="Tamanho da letra">${ic('type', 'sm')}</button>
        <button class="stage-btn" data-act="stageLight" aria-label="Alternar claro e escuro">${ic('sun', 'sm')}</button>
        <button class="stage-btn" data-go="#/cifra/${s.id}/${enc(k)}${e ? '/' + e.id : ''}" aria-label="Fechar modo palco">${ic('x', 'sm')}</button></div>
      <div class="stage-scroll" id="stage-scroll" style="font-size:${sizes[prefs.size]}px">${renderChart(s.chart, s.key, k)}<div class="pad"></div></div>
      <div class="stage-ctrl"><div class="line"><span>Rolagem automática</span><button class="speed" data-act="stageSpeed" aria-label="Velocidade">${fmtSpeed(prefs.speed)}</button></div>
        <div class="bar"><i id="stage-bar"></i></div>
        <div class="line"><button class="stage-btn" style="background:transparent" ${prv ? `data-go="#/palco/${prv.songId}/${enc(prv.key)}/${e.id}"` : 'disabled'} aria-label="Música anterior">${ic('prev', 'sm')}</button>
          <button class="playbtn" data-act="stagePlay" aria-label="${prefs.playing ? 'Pausar' : 'Rolar'}">${ic(prefs.playing ? 'pause' : 'play')}</button>
          <button class="next" ${nxt ? `data-go="#/palco/${nxt.songId}/${enc(nxt.key)}/${e.id}"` : 'disabled'} aria-label="Próxima música"><span><small>PRÓXIMA</small>${nxt ? esc(song(nxt.songId).title) : 'Fim'}</span>${ic('next', 'sm')}</button></div></div>
    </div>`;
  };

  let shareOpts = { reps: true, reh: true, pend: false };
  function shareText(e) {
    const t = (r) => (e.team[r].pid ? first(person(e.team[r].pid)) : null);
    const d = parse(e.date);
    const lines = ['*ESCALA DO LOUVOR · ICVJ*', `*${e.title} · ${WD[d.getDay()]}, ${fmtNum(e.date)} · ${hourShort(e.time)}*`];
    if (shareOpts.reh && e.rehearsal) lines.push(`Ensaio: ${WD[parse(e.rehearsal.date).getDay()].toLowerCase()}, ${fmtNum(e.rehearsal.date)} · ${hourShort(e.rehearsal.time)}`);
    lines.push('');
    const min = e.team.ministro.pid ? person(e.team.ministro.pid) : null;
    if (min) lines.push(`${min.fem ? 'Ministra' : 'Ministro'}: ${min.name}`);
    const bv = [t('bv1'), t('bv2')].filter(Boolean);
    if (bv.length) lines.push(`Backing: ${bv.join(' e ')}`);
    const pair = (a, b) => [a, b].filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`).join(' · ');
    [pair(['Violão', t('violao')], ['Guitarra', t('guitarra')]), pair(['Teclado', t('teclado')], ['Baixo', t('baixo')]), pair(['Bateria', t('bateria')], ['', null]), pair(['Som e mídia', t('som')], ['Projeção', t('projecao')])]
      .filter(Boolean).forEach((l) => lines.push(l));
    if (shareOpts.reps && e.setlist.length) {
      lines.push('', '*Repertório*');
      e.setlist.forEach((x, i) => lines.push(`${i + 1}. ${song(x.songId).title} (${x.key})`));
    }
    if (shareOpts.pend) {
      const p = ROLES.map((r) => e.team[r.key]).filter((x) => x.pid && x.status === 'pendente').map((x) => first(person(x.pid)));
      if (p.length) lines.push('', `Aguardando confirmação: ${p.join(', ')}`);
    }
    lines.push('', 'Confirme sua presença pelo app.');
    return lines.join('\n');
  }
  const waFormat = (txt) => esc(txt).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

  views.compartilhar = (id) => {
    const e = event(id);
    if (!e) return notFound();
    const txt = shareText(e);
    const now = new Date();
    const sw = (k, label) => `<div class="row"><div class="grow"><div class="t" style="font-weight:500">${label}</div></div><label class="switch"><input type="checkbox" id="opt-${k}" data-act-change="shareOpt" data-k="${k}" ${shareOpts[k] ? 'checked' : ''}><span></span></label></div>`;
    return `
      <header class="top">${back('#/escala/' + e.id)}<div class="grow"><h1>Compartilhar escala</h1><div class="sub">Pré-visualização da mensagem</div></div></header>
      <div class="chat-bg"><div class="bubble">${waFormat(txt)}<div class="meta">${pad(now.getHours())}:${pad(now.getMinutes())} ✓✓</div></div></div>
      <section class="sec"><div class="sec-h"><h2>Incluir na mensagem</h2></div>
        <div class="list">${sw('reps', 'Repertório com tons')}${sw('reh', 'Horário do ensaio')}${sw('pend', 'Marcar quem não confirmou')}</div></section>
      <div class="btn-row"><button class="btn ghost" data-act="copy" data-ev="${e.id}">${ic('copy', 'sm')} Copiar</button><a class="btn whats" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">${ic('chat', 'sm')} Abrir WhatsApp</a></div>`;
  };

  views.avisos = () => {
    const rows = S.mural.slice().sort((a, b) => b.at - a.at).map((m) => `<div class="mural"><span class="ic">${ic('mega', 'sm')}</span><div class="grow" style="flex:1;min-width:0"><p>${esc(m.text)}</p><small>${esc(m.author)} • ${ago(m.at)}</small></div>${S.leader ? `<button class="iconbtn" style="width:32px;height:32px;background:transparent;border:0" data-act="rmAviso" data-id="${m.id}" aria-label="Apagar aviso">${ic('trash', 'sm')}</button>` : ''}</div>`).join('');
    return `
      <header class="top big"><div class="grow"><h1>Avisos</h1><div class="sub">Mural do ministério</div></div></header>
      ${S.leader ? `<form class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px" data-form="aviso"><div class="field"><label for="aviso-txt">Novo aviso</label><textarea id="aviso-txt" class="plain" placeholder="Ex.: Ensaio extra na sexta às 19h" required></textarea></div><button class="btn primary" type="submit">${ic('send', 'sm')} Publicar no mural</button></form>` : ''}
      <section class="sec" style="gap:8px">${rows || '<div class="card empty-state">Nenhum aviso ainda.</div>'}</section>`;
  };

  views.perfil = () => {
    const u = me();
    const mine = upcoming().filter((e) => e.published && myRole(e)).length;
    const chips = SKILLS.map(([k, label]) => `<button type="button" class="chip soft ${u.skills.includes(k) ? 'on' : ''}" data-act="toggleChip" data-skill="${k}" aria-pressed="${u.skills.includes(k)}">${label}</button>`).join('');
    return `
      <header class="top big"><div class="grow"><h1>Perfil</h1></div>${S.leader ? '<span class="tag">Líder</span>' : ''}</header>
      <div class="card row" style="padding:16px"><button class="avatar-edit" data-act="photo" aria-label="${u.photo ? 'Trocar foto' : 'Colocar foto'}">${avatar(u, 'lg')}<span class="cam">${ic('camera', 'xs')}</span></button><input type="file" id="photo-in" accept="image/*" hidden><div class="grow"><div class="t" style="font-size:18px">${esc(u.name)}</div><div class="s">${esc(session.user.email || '')}</div><div class="s">${mine} escala${mine === 1 ? '' : 's'} pela frente</div></div></div>
      <form class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px" data-form="perfil">
        <div class="field"><label for="pf-name">Nome</label><input id="pf-name" value="${esc(u.name)}" maxlength="80" required></div>
        <div class="field"><label>Funções que você exerce</label><div class="chips" style="flex-wrap:wrap" id="pf-skills">${chips}</div></div>
        <div class="field"><label for="pf-fem">Na escala, aparecer como</label><select id="pf-fem"><option value="0" ${u.fem ? '' : 'selected'}>Ministro</option><option value="1" ${u.fem ? 'selected' : ''}>Ministra</option></select></div>
        <button class="btn primary" type="submit">Salvar perfil</button>
      </form>
      <div class="list">
        <button class="row" data-go="#/disponibilidade"><div class="grow"><div class="t" style="font-weight:500">Minha disponibilidade</div></div><span class="chev">${ic('right', 'sm')}</span></button>
        ${sings(u) || repOf(u.id).length ? `<button class="row" data-go="#/repertorio/${u.id}"><div class="grow"><div class="t" style="font-weight:500">Meu repertório</div><div class="s">${repOf(u.id).length} música${repOf(u.id).length === 1 ? '' : 's'}</div></div><span class="chev">${ic('right', 'sm')}</span></button>` : ''}
        ${S.leader ? `<button class="row" data-go="#/equipe"><div class="grow"><div class="t" style="font-weight:500">Equipe e convites</div><div class="s">${S.people.length} membro${S.people.length === 1 ? '' : 's'}</div></div><span class="chev">${ic('right', 'sm')}</span></button>` : ''}
        <div class="row" style="flex-wrap:wrap;gap:10px"><div class="grow"><div class="t" style="font-weight:500">Aparência</div><div class="s">Modo verde deixa o app todo no verde da igreja</div></div>
          <div class="seg three" style="width:100%">${[['claro', 'Claro'], ['verde', 'Verde'], ['auto', 'Automático']].map(([k, l]) => `<button type="button" class="${getTheme() === k ? 'on' : ''}" data-act="theme" data-t="${k}" aria-pressed="${getTheme() === k}">${l}</button>`).join('')}</div></div>
        <button class="row" data-act="changePw"><div class="grow"><div class="t" style="font-weight:500">Trocar senha</div></div><span class="chev">${ic('right', 'sm')}</span></button>
        <button class="row" data-act="logout" style="color:var(--danger)"><div class="grow"><div class="t" style="font-weight:500">Sair da conta</div></div></button>
      </div>
      <p class="fine">Louvor ICVJ • Ministério de Louvor</p>`;
  };

  let inviteCode = null;
  views.equipe = () => {
    if (!S.leader) return notFound();
    const rows = S.people.map((p) => {
      const sk = p.skills.map((k) => (SKILLS.find((x) => x[0] === k) || [k, k])[1]).join(' • ') || 'Sem funções marcadas';
      return `<button class="row" data-act="member" data-id="${p.id}">${avatar(p)}<div class="grow"><div class="t">${esc(p.name)}${p.id === S.meId ? ' (você)' : ''}</div><div class="s">${esc(sk)}</div></div>${p.leader ? '<span class="tag">Líder</span>' : ''}<span class="chev">${ic('right', 'sm')}</span></button>`;
    }).join('');
    return `
      <header class="top">${back('#/perfil')}<div class="grow"><h1>Equipe e convites</h1><div class="sub">Quem faz parte do ministério</div></div></header>
      <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="lbl">Código do ministério</div>
        <div style="display:flex;align-items:center;gap:10px;justify-content:space-between"><b style="font-family:var(--mono);font-size:22px;letter-spacing:.12em">${inviteCode ? esc(inviteCode) : '••••••••'}</b>
          ${inviteCode ? `<button class="link" style="color:var(--brand);font-weight:600" data-act="newCode">Gerar outro</button>` : `<button class="link" style="color:var(--brand);font-weight:600" data-act="showCode">Mostrar</button>`}</div>
        <p class="s" style="margin:0;font-size:13px;color:var(--muted)">Quem tiver este código consegue criar conta no app. Se ele vazar, gere outro.</p>
        <div class="btn-row"><button class="btn ghost" data-act="copyInvite">${ic('copy', 'sm')} Copiar convite</button>${inviteCode ? `<a class="btn whats" href="https://wa.me/?text=${encodeURIComponent(inviteText(inviteCode))}" target="_blank" rel="noopener">${ic('chat', 'sm')} Enviar</a>` : `<button class="btn whats" data-act="showCode">${ic('chat', 'sm')} Enviar</button>`}</div>
      </section>
      <section class="sec"><div class="sec-h"><h2>Membros</h2><span class="link">${S.people.length}</span></div><div class="list">${rows}</div></section>`;
  };

  /* ---------------- Entrar / criar conta ---------------- */
  let authTab = 'entrar';
  function authView() {
    const login = `
      <form class="auth-form" data-form="login">
        <div class="field"><label for="lg-email">E-mail</label><input id="lg-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="lg-pw">Senha</label><input id="lg-pw" type="password" autocomplete="current-password" required minlength="6"></div>
        <button class="btn primary block" type="submit">Entrar</button>
        <p class="fine">Esqueceu a senha? Peça ao líder uma senha temporária.</p>
      </form>`;
    const signup = `
      <form class="auth-form" data-form="signup">
        <div class="field"><label for="su-name">Seu nome</label><input id="su-name" autocomplete="name" required maxlength="80" placeholder="Ex.: Rebeca Souza"></div>
        <div class="field"><label for="su-email">E-mail</label><input id="su-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="su-pw">Crie uma senha</label><input id="su-pw" type="password" autocomplete="new-password" required minlength="6" placeholder="Pelo menos 6 caracteres"></div>
        <div class="field"><label for="su-code">Código do ministério</label><input id="su-code" autocapitalize="characters" autocomplete="off" required placeholder="O líder envia no grupo" style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.1em"></div>
        <button class="btn primary block" type="submit">Criar conta</button>
      </form>`;
    return `<div class="auth">
      <div class="auth-hero"><img src="${LOGO}" alt="" width="84" height="84"><b>Louvor ICVJ</b><span>Ministério de Louvor</span></div>
      <div class="auth-card card">
        <div class="seg" role="tablist"><button role="tab" class="${authTab === 'entrar' ? 'on' : ''}" aria-selected="${authTab === 'entrar'}" data-act="authTab" data-t="entrar">Entrar</button><button role="tab" class="${authTab === 'criar' ? 'on' : ''}" aria-selected="${authTab === 'criar'}" data-act="authTab" data-t="criar">Criar conta</button></div>
        ${authTab === 'entrar' ? login : signup}
      </div>${installCard()}</div>`;
  }
  const loadingView = () => `<div class="empty-state" style="padding-top:40vh">Carregando escalas…</div>`;
  const orphanView = () => `<header class="top big"><div class="grow"><h1>Quase lá</h1></div></header>
    <div class="card empty-state">Sua conta (${esc(session.user.email || '')}) ainda não faz parte do ministério. Crie a conta pelo app usando o código que o líder envia.</div>
    <button class="btn ghost block" data-act="logout">Sair</button>`;

  function notFound() { return `<header class="top">${back('#/')}<div class="grow"><h1>Não encontrado</h1></div></header><div class="card empty-state">Esse item não existe mais.</div>`; }
  const enc = (s) => encodeURIComponent(s);
  const dec = (s) => decodeURIComponent(s);

  /* ---------------- Roteador ---------------- */
  const TABS = [['inicio', '#/', 'home', 'Início'], ['escalas', '#/escalas', 'cal', 'Escalas'], ['musicas', '#/musicas', 'music', 'Músicas'], ['avisos', '#/avisos', 'mega', 'Avisos'], ['perfil', '#/perfil', 'user', 'Perfil']];
  const TAB_OF = { inicio: 'inicio', escalas: 'escalas', escala: 'escalas', montar: 'escalas', disponibilidade: 'escalas', compartilhar: 'escalas', musicas: 'musicas', repertorio: 'musicas', cifra: 'musicas', palco: 'musicas', avisos: 'avisos', perfil: 'perfil', equipe: 'perfil' };
  let current = '';

  // Tema: claro, verde ou automático (segue o modo escuro do celular)
  const THEME_KEY = 'louvor-theme';
  const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'claro'; } catch (e) { return 'claro'; } };
  const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const t = getTheme(), verde = t === 'verde' || (t === 'auto' && darkMQ && darkMQ.matches);
    if (verde) document.documentElement.dataset.theme = 'verde'; else delete document.documentElement.dataset.theme;
  }
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', () => { applyTheme(); rerender(); });
  const cssBg = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F4F6F3';
  const setBar = (c) => { const m = document.querySelector('meta[name="theme-color"]'); if (m && m.content !== c) m.content = c; };
  function route() {
    const view = document.getElementById('view'), tabs = document.getElementById('tabs');
    stopScroll();
    if (!session || !S || !me()) {
      document.body.classList.remove('stage');
      document.body.classList.toggle('authpage', !session);
      tabs.hidden = true;
      view.innerHTML = !session ? authView() : !S ? loadingView() : orphanView();
      setBar(!session ? '#006C00' : cssBg());
      return;
    }
    document.body.classList.remove('authpage');
    tabs.hidden = false;
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...args] = h.split('/').filter(Boolean);
    const v = views[name] ? name : 'inicio';
    if (v !== 'palco') { stage && (stage.playing = false); releaseWake(); }
    document.body.classList.toggle('stage', v === 'palco');
    view.innerHTML = views[v](...args);
    setBar(v === 'palco' ? '#0A120A' : cssBg());
    const tab = TAB_OF[v];
    tabs.innerHTML = TABS.map(([k, href, icon, label]) => `<a href="${href}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></a>`).join('');
    if (h !== current) {
      // Animação de troca de tela: entra pela direita, volta pela esquerda, troca de aba só esmaece
      const prev = (current || '').split('/').filter(Boolean), next = h.split('/').filter(Boolean);
      const dir = v === 'palco' || current === undefined ? '' : TAB_OF[views[prev[0]] ? prev[0] : 'inicio'] !== tab && next.length <= 1 ? 'tab' : next.length >= prev.length ? 'in' : 'back';
      view.classList.remove('in', 'back', 'tab');
      if (dir) { void view.offsetWidth; view.classList.add(dir); }
      window.scrollTo(0, 0); current = h;
    }
    if (v === 'palco') mountStage();
    if (v === 'musicas') mountSongSearch();
    closeSheet();
  }
  const rerender = () => {
    if (document.body.classList.contains('stage')) return; // não interrompe o modo palco
    const y = window.scrollY; route(); window.scrollTo(0, y);
  };
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

  /* ---------------- Ações ---------------- */
  const A = {};
  const setStatus = (evId, role, st) => must(sb.rpc('set_my_status', { p_event: evId, p_role: role, p_status: st }));

  A.setMine = (el) => {
    const e = event(el.dataset.ev), rk = myRole(e), st = el.dataset.st;
    act(async () => {
      await setStatus(e.id, rk, st);
      if (st === 'pendente') await must(sb.from('unavailability').delete().eq('member_id', S.meId).eq('event_id', e.id));
    }, st === 'confirmado' ? 'Presença confirmada. O líder já vê no app.' : null);
  };
  A.cantGo = (el) => {
    const e = event(el.dataset.ev);
    const reasons = ['Viagem', 'Trabalho', 'Saúde', 'Compromisso familiar'];
    sheet(`<h3>Não pode servir?</h3><div class="sub">${esc(e.title)} • ${fmtShort(e.date)}</div>
      <div class="chips" style="flex-wrap:wrap">${reasons.map((r, i) => `<button class="chip soft ${i === 0 ? 'on' : ''}" data-reason="${r}">${r}</button>`).join('')}</div>
      <div class="field"><label for="cant-note">Recado para o líder (opcional)</label><input id="cant-note" placeholder="Ex.: posso trocar com alguém"></div>
      <div class="btn-row"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn danger" id="cant-ok">Avisar o líder</button></div>`, (sh) => {
      let reason = reasons[0];
      sh.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { reason = b.dataset.reason; sh.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x === b)); }));
      sh.querySelector('#cant-ok').addEventListener('click', (ev) => {
        ev.currentTarget.disabled = true;
        const note = sh.querySelector('#cant-note').value.trim();
        closeSheet();
        act(async () => {
          await setStatus(e.id, myRole(e), 'indisponivel');
          await must(sb.from('unavailability').insert({ member_id: S.meId, from_date: e.date, to_date: e.date, reason: reason + (note ? ' — ' + note : ''), event_id: e.id }));
        }, 'Aviso enviado. O líder vai buscar substituto.');
      });
    });
  };
  A.close = () => closeSheet();

  A.eventMenu = (el) => {
    const e = event(el.dataset.ev);
    sheet(`<h3>${esc(e.title)}</h3><div class="sub">${fmtLong(e.date)} • ${e.time}</div><div class="list">
      ${S.leader ? `<button class="row" data-go="#/montar/${e.id}">${ic('edit', 'sm')}<div class="grow t">Montar escala</div></button>` : ''}
      ${e.setlist.length ? `<button class="row" data-go="#/palco/${e.setlist[0].songId}/${enc(e.setlist[0].key)}/${e.id}">${ic('expand', 'sm')}<div class="grow t">Modo palco</div></button>` : ''}
      <button class="row" data-go="#/compartilhar/${e.id}">${ic('chat', 'sm')}<div class="grow t">Compartilhar no WhatsApp</div></button>
      ${S.leader ? `<button class="row" data-act="delEvent" data-ev="${e.id}" style="color:var(--danger)">${ic('trash', 'sm')}<div class="grow t">Excluir escala</div></button>` : ''}</div>`);
  };
  A.delEvent = (el) => {
    const e = event(el.dataset.ev);
    sheet(`<h3>Excluir “${esc(e.title)}”?</h3><div class="sub">${fmtLong(e.date)}. A escala e o repertório deste culto serão apagados para todos.</div>
      <div class="btn-row"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn danger" id="del-ok">Excluir</button></div>`, (sh) => {
      sh.querySelector('#del-ok').addEventListener('click', async () => {
        closeSheet();
        if (await act(() => sb.from('events').delete().eq('id', e.id), 'Escala excluída.')) go('#/escalas');
      });
    });
  };

  A.newEvent = () => {
    const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    sheet(`<h3>Nova escala</h3>
      <div class="field"><label for="ne-title">Culto</label><select id="ne-title"><option>Culto de Adoração</option><option>Culto da Libertação</option><option>Reunião de Oração</option><option>Reunião HOPE</option><option>Santa Ceia</option><option>Evento especial</option></select></div>
      <div class="grid2"><div class="field"><label for="ne-date">Data</label><input id="ne-date" type="date" value="${iso(d)}" min="${todayISO()}"></div><div class="field"><label for="ne-time">Horário</label><input id="ne-time" type="time" value="18:00"></div></div>
      <div class="grid2"><div class="field"><label for="ne-rd">Ensaio (opcional)</label><input id="ne-rd" type="date"></div><div class="field"><label for="ne-rt">Hora do ensaio</label><input id="ne-rt" type="time" value="16:00"></div></div>
      <button class="btn primary block" id="ne-ok">Criar e montar escala</button>`, (sh) => {
      sh.querySelector('#ne-ok').addEventListener('click', async (ev) => {
        const date = sh.querySelector('#ne-date').value, time = sh.querySelector('#ne-time').value;
        if (!date || !time) { toast('Escolha a data e o horário.'); return; }
        ev.currentTarget.disabled = true;
        const rd = sh.querySelector('#ne-rd').value;
        try {
          const { data } = await must(sb.from('events').insert({ title: sh.querySelector('#ne-title').value, date, time, rehearsal_date: rd || null, rehearsal_time: rd ? (sh.querySelector('#ne-rt').value || '16:00') : null }).select('id').single());
          closeSheet(); await reload(); go('#/montar/' + data.id);
        } catch (e) { ev.currentTarget.disabled = false; toast(errMsg(e)); }
      });
    });
  };

  A.pick = (el) => {
    const e = event(el.dataset.ev), r = roleDef(el.dataset.role);
    const cur = e.team[r.key].pid;
    const used = {}; ROLES.forEach((x) => { if (e.team[x.key].pid && x.key !== r.key) used[e.team[x.key].pid] = x.label; });
    const ppl = S.people.filter((p) => p.skills.includes(r.skill)).sort((a, b) => isUnavail(a.id, e.date) - isUnavail(b.id, e.date) || monthCount(a.id, e.date) - monthCount(b.id, e.date));
    const others = S.people.filter((p) => !p.skills.includes(r.skill));
    const row = (p) => {
      const off = isUnavail(p.id, e.date);
      const tag = off ? pill('indisponivel') : used[p.id] ? `<span class="count">${esc(used[p.id])}</span>` : `<span class="count">${monthCount(p.id, e.date)}× no mês</span>`;
      return `<button class="row" data-act="assign" data-ev="${e.id}" data-role="${r.key}" data-pid="${p.id}" ${p.id === cur ? 'style="background:var(--brand-soft)"' : ''}>${avatar(p)}<div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${p.id === cur ? 'Escalado agora' : off ? esc((S.unavail.find((u) => u.pid === p.id && u.from <= e.date && e.date <= u.to) || {}).reason || '') : ''}</div></div>${tag}</button>`;
    };
    sheet(`<h3>${esc(r.label)}</h3><div class="sub">${esc(e.title)} • ${fmtShort(e.date)}</div>
      <div class="list">${ppl.map(row).join('') || '<div class="empty-state">Ninguém marcou essa função no perfil ainda.</div>'}</div>
      ${others.length ? `<details><summary class="lbl" style="cursor:pointer;padding:4px 0">Outras pessoas</summary><div class="list" style="margin-top:8px">${others.map(row).join('')}</div></details>` : ''}
      ${cur ? `<button class="btn ghost block" data-act="assign" data-ev="${e.id}" data-role="${r.key}" data-pid="">Deixar vazio</button>` : ''}`);
  };
  A.assign = (el) => {
    const e = event(el.dataset.ev), rk = el.dataset.role, pid = el.dataset.pid || null;
    closeSheet();
    act(async () => {
      if (pid) {
        const dup = ROLES.filter((x) => x.key !== rk && e.team[x.key].pid === pid && x.skill === roleDef(rk).skill);
        for (const x of dup) await must(sb.from('assignments').delete().eq('event_id', e.id).eq('role_key', x.key));
        await must(sb.from('assignments').upsert({ event_id: e.id, role_key: rk, member_id: pid, status: isUnavail(pid, e.date) ? 'indisponivel' : 'pendente' }, { onConflict: 'event_id,role_key' }));
      } else {
        await must(sb.from('assignments').delete().eq('event_id', e.id).eq('role_key', rk));
      }
    }, pid ? `${first(person(pid))} escalado(a) em ${roleDef(rk).label.toLowerCase()}.` : null);
  };
  const saveSetlist = (e, list, msg) => act(() => sb.from('events').update({ setlist: list }).eq('id', e.id), msg);
  A.addSong = (el) => {
    const e = event(el.dataset.ev);
    if (!S.songs.length) { toast('Cadastre uma música primeiro, na aba Músicas.'); return; }
    const ppl = S.people.filter((p) => p.skills.includes('ministro') || p.skills.includes('vocal'));
    const pool = ppl.length ? ppl : S.people;
    const defLead = e.team.ministro.pid || pool[0].id;
    sheet(`<h3>Adicionar música</h3>
      <div class="field"><label for="as-lead">Quem ministra</label><select id="as-lead">${pool.map((p) => `<option value="${p.id}" ${p.id === defLead ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label for="as-song">Música</label><select id="as-song"></select></div>
      <div class="field"><label for="as-key">Tom</label><select id="as-key">${ALL_KEYS.map((k) => `<option>${k}</option>`).join('')}</select></div></div>
      <button class="btn primary block" id="as-ok">Adicionar ao repertório</button>`, (sh) => {
      const sel = sh.querySelector('#as-song'), lead = sh.querySelector('#as-lead'), key = sh.querySelector('#as-key');
      const sync = () => { const s = song(sel.value); key.value = (s.pref && s.pref[lead.value]) || s.key; };
      const fill = () => {
        const cur = sel.value, pid = lead.value, all = S.songs.slice().sort((a, b) => a.title.localeCompare(b.title, 'pt'));
        const opt = (s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.title)} (${esc(s.pref[pid] || s.key)})</option>`;
        const mine = all.filter((s) => s.pref[pid]), rest = all.filter((s) => !s.pref[pid]);
        sel.innerHTML = mine.length ? `<optgroup label="Repertório de ${esc(first(person(pid)))}">${mine.map(opt).join('')}</optgroup><optgroup label="Outras músicas">${rest.map(opt).join('')}</optgroup>` : all.map(opt).join('');
        sync();
      };
      sel.addEventListener('change', sync); lead.addEventListener('change', fill); fill();
      sh.querySelector('#as-ok').addEventListener('click', () => { closeSheet(); saveSetlist(e, e.setlist.concat({ songId: sel.value, key: key.value, lead: lead.value })); });
    });
  };
  A.rmSong = (el) => { const e = event(el.dataset.ev); const list = e.setlist.slice(); list.splice(Number(el.dataset.i), 1); saveSetlist(e, list); };
  A.draft = () => toast('Rascunho salvo. A equipe vê a escala só depois de publicada.');
  A.publish = (el) => {
    const e = event(el.dataset.ev);
    if (!filled(e)) { toast('Escale pelo menos uma pessoa antes de publicar.'); return; }
    act(() => sb.from('events').update({ published: true }).eq('id', e.id), 'Escala publicada. Agora é só enviar no grupo.').then((ok) => ok && go('#/compartilhar/' + e.id));
  };

  A.cal = (el) => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(el.dataset.d), 1); rerender(); };
  A.day = (el) => {
    const d = el.dataset.d;
    const ex = S.unavail.find((u) => u.pid === S.meId && u.from === d && u.to === d);
    if (ex) { removeOff(ex.id); return; }
    if (isUnavail(S.meId, d)) { toast('Este dia faz parte de um período. Remova o período na lista abaixo.'); return; }
    offSheet(d, d);
  };
  A.addOff = () => offSheet(todayISO(), todayISO());
  function offSheet(from, to) {
    sheet(`<h3>Marcar indisponibilidade</h3><div class="sub">O líder verá isso ao montar a escala.</div>
      <div class="grid2"><div class="field"><label for="off-from">De</label><input id="off-from" type="date" value="${from}" min="${todayISO()}"></div><div class="field"><label for="off-to">Até</label><input id="off-to" type="date" value="${to}" min="${todayISO()}"></div></div>
      <div class="field"><label for="off-reason">Motivo</label><input id="off-reason" placeholder="Ex.: Viagem em família"></div>
      <button class="btn primary block" id="off-ok">Salvar</button>`, (sh) => {
      sh.querySelector('#off-ok').addEventListener('click', () => {
        let a = sh.querySelector('#off-from').value, b = sh.querySelector('#off-to').value || a;
        if (!a) { toast('Escolha a data.'); return; }
        if (b < a) [a, b] = [b, a];
        const reason = sh.querySelector('#off-reason').value.trim();
        const hit = S.events.filter((e) => e.date >= a && e.date <= b && myRole(e));
        closeSheet();
        act(async () => {
          await must(sb.from('unavailability').insert({ member_id: S.meId, from_date: a, to_date: b, reason }));
          for (const e of hit) await setStatus(e.id, myRole(e), 'indisponivel');
        }, hit.length ? `Salvo. Você estava escalado(a) em ${hit.length} culto(s); o líder já vê o alerta.` : 'Indisponibilidade salva.');
      });
    });
  }
  function removeOff(id) {
    const u = S.unavail.find((x) => x.id === id);
    act(async () => {
      await must(sb.from('unavailability').delete().eq('id', id));
      if (!u) return;
      const back_ = S.events.filter((e) => e.date >= u.from && e.date <= u.to && myRole(e) && e.team[myRole(e)].status === 'indisponivel'
        && !S.unavail.some((x) => x.id !== id && x.pid === S.meId && x.from <= e.date && e.date <= x.to));
      for (const e of back_) await setStatus(e.id, myRole(e), 'pendente');
    }, 'Indisponibilidade removida.');
  }
  A.rmOff = (el) => removeOff(el.dataset.id);

  A.cat = (el) => { songCat = el.dataset.c; rerender(); };
  A.newSong = () => songSheet(null);
  A.songMenu = (el) => {
    const s = song(el.dataset.song);
    sheet(`<h3>${esc(s.title)}</h3><div class="list">
      <button class="row" data-act="editSong" data-song="${s.id}">${ic('edit', 'sm')}<div class="grow t">Editar música e cifra</div></button>
      ${s.pref[S.meId] ? `<button class="row" data-act="repRm" data-pid="${S.meId}" data-song="${s.id}">${ic('minus', 'sm')}<div class="grow t">Tirar do meu repertório</div></button>` : ''}
      ${S.leader ? `<button class="row" data-act="delSong" data-song="${s.id}" style="color:var(--danger)">${ic('trash', 'sm')}<div class="grow t">Remover do repertório</div></button>` : ''}</div>`);
  };
  A.editSong = (el) => songSheet(song(el.dataset.song));
  A.listen = (el) => { setPlayer(listenOpen === el.dataset.song ? null : song(el.dataset.song)); rerender(); };
  A.playerMin = () => { const r = document.getElementById('player'); r.classList.toggle('min'); sizePlayer(); };
  A.playerClose = () => { setPlayer(null); rerender(); };
  A.addMedia = (el) => {
    const s = song(el.dataset.song);
    const yt = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(s.title + ' louvor');
    sheet(`<h3>Ouvir “${esc(s.title)}”</h3><div class="sub">Cole o link do vídeo ou do áudio uma vez e ele passa a tocar aqui no app para toda a equipe.</div>
      <a class="btn ghost block" href="${yt}" target="_blank" rel="noopener">${ic('search', 'sm')} Procurar no YouTube</a>
      <div class="field"><label for="md-url">Link do YouTube, Spotify ou arquivo MP3</label><input id="md-url" type="url" inputmode="url" placeholder="https://youtu.be/…" autocomplete="off"></div>
      <button class="btn primary block" id="md-ok">Salvar e ouvir</button>`, (sh) => {
      sh.querySelector('#md-ok').addEventListener('click', async () => {
        const url = sh.querySelector('#md-url').value.trim();
        if (!/^https?:\/\/\S+$/.test(url)) { toast('Cole um link que comece com https://'); return; }
        closeSheet();
        const ok = await act(() => sb.from('songs').update({ media_url: url }).eq('id', s.id), mediaEmbed(url) ? 'Link salvo. Tocando aqui no app.' : 'Link salvo. Ele abre fora do app.');
        if (ok && mediaEmbed(url)) { setPlayer(song(s.id)); rerender(); }
      });
    });
  };
  const repSave = (pid, sid, k, msg) => act(() => sb.from('repertoire').upsert({ member_id: pid, song_id: sid, key: k }, { onConflict: 'member_id,song_id' }), msg);
  A.myKey = (el) => {
    const had = song(el.dataset.song).pref[S.meId];
    repSave(S.meId, el.dataset.song, el.dataset.k, had ? `Tom ${el.dataset.k} salvo como o seu nesta música.` : `Música adicionada ao seu repertório em ${el.dataset.k}.`);
  };
  const keyOpts = (sel) => ALL_KEYS.map((k) => `<option ${k === sel ? 'selected' : ''}>${k}</option>`).join('');
  A.repAdd = (el) => {
    const pid = el.dataset.pid, p = person(pid);
    const free = S.songs.filter((s) => !s.pref[pid]).sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    if (!free.length) { toast(S.songs.length ? 'Todas as músicas já estão neste repertório.' : 'Cadastre uma música primeiro.'); return; }
    sheet(`<h3>Adicionar ao repertório${pid === S.meId ? '' : ' de ' + esc(first(p))}</h3>
      <div class="field"><label for="ra-song">Música</label><select id="ra-song">${free.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></div>
      <div class="field"><label for="ra-key">Tom ${pid === S.meId ? 'que você canta' : 'de ' + esc(first(p))}</label><select id="ra-key"></select></div>
      <button class="btn primary block" id="ra-ok">Adicionar</button>`, (sh) => {
      const sel = sh.querySelector('#ra-song'), key = sh.querySelector('#ra-key');
      const sync = () => { key.innerHTML = keyOpts(song(sel.value).key); };
      sel.addEventListener('change', sync); sync();
      sh.querySelector('#ra-ok').addEventListener('click', () => { closeSheet(); repSave(pid, sel.value, key.value, 'Música adicionada ao repertório.'); });
    });
  };
  A.repEdit = (el) => {
    const pid = el.dataset.pid, s = song(el.dataset.song);
    sheet(`<h3>${esc(s.title)}</h3><div class="sub">Original em ${esc(s.key)}</div>
      <div class="field"><label for="re-key">Tom ${pid === S.meId ? 'que você canta' : 'de ' + esc(first(person(pid)))}</label><select id="re-key">${keyOpts(s.pref[pid])}</select></div>
      <button class="btn primary block" id="re-ok">Salvar tom</button>
      <button class="btn ghost block" data-act="repRm" data-pid="${pid}" data-song="${s.id}" style="color:var(--danger)">Tirar do repertório</button>`, (sh) => {
      sh.querySelector('#re-ok').addEventListener('click', () => { closeSheet(); repSave(pid, s.id, sh.querySelector('#re-key').value, 'Tom salvo.'); });
    });
  };
  A.repRm = (el) => { closeSheet(); act(() => sb.from('repertoire').delete().eq('member_id', el.dataset.pid).eq('song_id', el.dataset.song), 'Música tirada do repertório.'); };
  A.delSong = (el) => {
    const s = song(el.dataset.song);
    const usedIn = S.events.filter((e) => e.date >= todayISO() && e.setlist.some((x) => x.songId === s.id));
    sheet(`<h3>Remover “${esc(s.title)}”?</h3><div class="sub">${usedIn.length ? `Ela está em ${usedIn.length} escala(s) futura(s) e sairá delas também.` : 'A cifra será apagada para todos.'}</div>
      <div class="btn-row"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn danger" id="ds-ok">Remover</button></div>`, (sh) => {
      sh.querySelector('#ds-ok').addEventListener('click', async () => {
        closeSheet();
        const ok = await act(async () => {
          for (const e of usedIn) await must(sb.from('events').update({ setlist: e.setlist.filter((x) => x.songId !== s.id) }).eq('id', e.id));
          await must(sb.from('songs').delete().eq('id', s.id));
        }, 'Música removida.');
        if (ok) go('#/musicas');
      });
    });
  };
  function songSheet(s) {
    const cats = Array.from(new Set(['Adoração', 'Celebração', 'Santa Ceia', ...S.songs.map((x) => x.cat)]));
    sheet(`<h3>${s ? 'Editar música' : 'Nova música'}</h3>
      <div class="field"><label for="ns-title">Título</label><input id="ns-title" value="${s ? esc(s.title) : ''}" placeholder="Nome da música" maxlength="120"></div>
      <div class="grid2"><div class="field"><label for="ns-cat">Categoria</label><select id="ns-cat">${cats.map((c) => `<option ${s && s.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="ns-key">Tom original</label><select id="ns-key">${ALL_KEYS.map((k) => `<option ${s && s.key === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
      <div class="grid2"><div class="field"><label for="ns-bpm">BPM</label><input id="ns-bpm" type="number" inputmode="numeric" min="20" max="300" value="${s ? s.bpm : 80}"></div>
        <div class="field"><label for="ns-sig">Compasso</label><select id="ns-sig">${['4/4', '3/4', '6/8', '2/4'].map((x) => `<option ${s && s.sig === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
      <div class="field"><label for="ns-media">Link para ouvir (YouTube, Spotify ou MP3)</label><input id="ns-media" type="url" inputmode="url" value="${s ? esc(s.media) : ''}" placeholder="https://youtu.be/…" autocomplete="off"></div>
      <div class="field"><label for="ns-chart">Cifra (acordes na linha de cima da letra; seções entre colchetes, ex.: [Refrão])</label><textarea id="ns-chart" rows="10" spellcheck="false" placeholder="[Verso 1]&#10;G        D&#10;Primeira linha da letra">${s ? esc(s.chart) : ''}</textarea></div>
      <button class="btn primary block" id="ns-ok">${s ? 'Salvar alterações' : 'Adicionar ao repertório'}</button>`, (sh) => {
      sh.querySelector('#ns-ok').addEventListener('click', async (ev) => {
        const title = sh.querySelector('#ns-title').value.trim();
        if (!title) { toast('Dê um título para a música.'); return; }
        const bpm = Math.min(300, Math.max(20, Number(sh.querySelector('#ns-bpm').value) || 80));
        const media = sh.querySelector('#ns-media').value.trim();
        if (media && !/^https?:\/\/\S+$/.test(media)) { toast('O link para ouvir precisa começar com https://'); return; }
        const data = { title, cat: sh.querySelector('#ns-cat').value, key: sh.querySelector('#ns-key').value, bpm, sig: sh.querySelector('#ns-sig').value, chart: sh.querySelector('#ns-chart').value, media_url: media || null };
        ev.currentTarget.disabled = true;
        try {
          const r = s ? await must(sb.from('songs').update(data).eq('id', s.id).select('id').single()) : await must(sb.from('songs').insert(data).select('id').single());
          closeSheet(); await reload(); go('#/cifra/' + r.data.id); toast('Música salva.');
        } catch (e) { ev.currentTarget.disabled = false; toast(errMsg(e)); }
      });
    });
  }

  function copyText(txt, okMsg) {
    const done = () => toast(okMsg);
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); ok ? done() : toast('Não consegui copiar. Selecione o texto e copie.');
    };
    try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (e) { fallback(); }
  }
  A.copy = (el) => copyText(shareText(event(el.dataset.ev)), 'Mensagem copiada. Cole no grupo do louvor.');
  A.rmAviso = (el) => act(() => sb.from('notices').delete().eq('id', el.dataset.id), 'Aviso apagado.');

  /* Perfil e equipe */
  A.theme = (el) => { try { localStorage.setItem(THEME_KEY, el.dataset.t); } catch (e) { /* ok */ } applyTheme(); rerender(); setBar(cssBg()); };
  A.photo = () => {
    const u = me();
    if (!u.photo) { pickPhoto(); return; }
    sheet(`<h3>Foto de perfil</h3><div class="list">
      <button class="row" data-act="photoPick">${ic('camera', 'sm')}<div class="grow t">Trocar foto</div></button>
      <button class="row" data-act="photoRm" style="color:var(--danger)">${ic('trash', 'sm')}<div class="grow t">Remover foto</div></button></div>`);
  };
  A.photoPick = () => { closeSheet(); pickPhoto(); };
  A.photoRm = () => { closeSheet(); act(() => sb.from('members').update({ avatar_url: null }).eq('id', S.meId), 'Foto removida.'); };
  function pickPhoto() {
    const inp = document.getElementById('photo-in');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      toast('Enviando foto…');
      try {
        const blob = await squareJpeg(f, 384);
        const path = `${S.meId}/${Date.now()}.jpg`;
        await must(sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
        const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        const old = me().photo;
        const ok = await act(() => sb.from('members').update({ avatar_url: url }).eq('id', S.meId), 'Foto salva.');
        // apaga a foto antiga para não acumular arquivos
        const m = ok && old && old.split('/avatars/')[1];
        if (m) sb.storage.from('avatars').remove([decodeURIComponent(m)]).catch(() => {});
      } catch (e) { toast(errMsg(e)); }
    };
    inp.click();
  }
  // Recorta no centro, deixa quadrada e reduz o tamanho antes de enviar
  function squareJpeg(file, size) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res(b) : rej(new Error('Não consegui ler essa imagem.'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Não consegui abrir essa imagem. Tente outra foto.')); };
      img.src = url;
    });
  }
  A.toggleChip = (el) => { el.classList.toggle('on'); el.setAttribute('aria-pressed', el.classList.contains('on')); };
  A.logout = async () => { setPlayer(null); authTab = 'entrar'; inviteCode = null; try { localStorage.removeItem(CACHE); } catch (e) { /* ok */ } await sb.auth.signOut(); };
  A.changePw = () => {
    sheet(`<h3>Trocar senha</h3>
      <div class="field"><label for="pw-new">Nova senha</label><input id="pw-new" type="password" autocomplete="new-password" minlength="6" placeholder="Pelo menos 6 caracteres"></div>
      <button class="btn primary block" id="pw-ok">Salvar nova senha</button>`, (sh) => {
      sh.querySelector('#pw-ok').addEventListener('click', async () => {
        const pw = sh.querySelector('#pw-new').value;
        if (pw.length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.'); return; }
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) { toast(errMsg(error)); return; }
        closeSheet(); toast('Senha alterada.');
      });
    });
  };
  async function callConta(body) {
    const { data, error } = await sb.functions.invoke('conta', { body });
    if (error) {
      let m = error.message;
      try { const j = await error.context.json(); m = j.error || m; } catch (e) { /* mantém a mensagem */ }
      throw new Error(m);
    }
    return data;
  }
  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const inviteText = (code) => `Você foi convidado(a) para o app do Louvor ICVJ, onde ficam as escalas e cifras do ministério.\n\n1. Abra ${appUrl()}\n2. Toque em "Criar conta"\n3. Use o código do ministério: ${code}\n\nNo celular, use "Adicionar à tela inicial" para instalar.`;
  async function ensureCode() {
    if (inviteCode) return inviteCode;
    const { data, error } = await sb.rpc('get_invite_code');
    if (error) throw error;
    inviteCode = data; return data;
  }
  A.showCode = async () => { try { await ensureCode(); rerender(); } catch (e) { toast(errMsg(e)); } };
  A.newCode = () => {
    sheet(`<h3>Gerar outro código?</h3><div class="sub">O código atual para de funcionar. Quem já tem conta continua entrando normalmente.</div>
      <div class="btn-row"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn primary" id="nc-ok">Gerar</button></div>`, (sh) => {
      sh.querySelector('#nc-ok').addEventListener('click', async () => {
        const { data, error } = await sb.rpc('new_invite_code');
        if (error) { toast(errMsg(error)); return; }
        inviteCode = data; closeSheet(); rerender(); toast('Novo código gerado.');
      });
    });
  };
  A.copyInvite = async () => { try { copyText(inviteText(await ensureCode()), 'Convite copiado. Cole no grupo do louvor.'); } catch (e) { toast(errMsg(e)); } };
  A.member = (el) => {
    const p = person(el.dataset.id);
    const chips = SKILLS.map(([k, label]) => `<button type="button" class="chip soft ${p.skills.includes(k) ? 'on' : ''}" data-act="toggleChip" data-skill="${k}" aria-pressed="${p.skills.includes(k)}">${label}</button>`).join('');
    sheet(`<div class="row" style="padding:0">${avatar(p)}<div class="grow"><h3>${esc(p.name)}</h3><div class="s" style="color:var(--muted);font-size:13px" id="mb-email"></div></div></div>
      <div class="field"><label>Funções</label><div class="chips" style="flex-wrap:wrap" id="mb-skills">${chips}</div></div>
      <button class="btn primary block" id="mb-save">Salvar funções</button>
      <div class="list"><div class="row"><div class="grow"><div class="t" style="font-weight:500">Líder</div><div class="s">Monta escalas, publica avisos, convida pessoas</div></div><label class="switch"><input type="checkbox" id="mb-leader" ${p.leader ? 'checked' : ''}><span></span></label></div></div>
      ${p.id !== S.meId ? `<div class="btn-row"><button class="btn ghost" id="mb-pw">Senha temporária</button><button class="btn ghost" id="mb-rm" style="color:var(--danger)">Remover</button></div><div id="mb-out"></div>` : ''}`, (sh) => {
      callConta({ action: 'email', member_id: p.id }).then((d) => { const e = sh.querySelector('#mb-email'); if (e) e.textContent = d.email || ''; }).catch(() => {});
      sh.querySelector('#mb-save').addEventListener('click', () => {
        const skills = Array.from(sh.querySelectorAll('#mb-skills .chip.on')).map((c) => c.dataset.skill);
        closeSheet(); act(() => sb.from('members').update({ skills }).eq('id', p.id), 'Funções salvas.');
      });
      sh.querySelector('#mb-leader').addEventListener('change', (ev) => {
        const v = ev.target.checked;
        closeSheet(); act(() => sb.from('members').update({ is_leader: v }).eq('id', p.id), v ? `${first(p)} agora é líder.` : `${first(p)} deixou de ser líder.`);
      });
      const pw = sh.querySelector('#mb-pw');
      if (pw) pw.addEventListener('click', async () => {
        pw.disabled = true;
        try {
          const d = await callConta({ action: 'senha_temporaria', member_id: p.id });
          sh.querySelector('#mb-out').innerHTML = `<div class="note">Nova senha de ${esc(first(p))}: <b style="font-family:var(--mono);font-size:16px;color:var(--ink)">${esc(d.password)}</b><br>Envie para a pessoa entrar com o e-mail ${esc(d.email || '')} e depois trocar a senha no Perfil.</div>`;
        } catch (e) { pw.disabled = false; toast(errMsg(e)); }
      });
      const rm = sh.querySelector('#mb-rm');
      if (rm) rm.addEventListener('click', () => {
        sh.querySelector('#mb-out').innerHTML = `<div class="alertbox"><div class="h">Remover ${esc(p.name)} do ministério?</div><p>A conta é apagada e a pessoa sai de todas as escalas.</p><button id="mb-rm-ok">Remover</button></div>`;
        sh.querySelector('#mb-rm-ok').addEventListener('click', async () => {
          try { await callConta({ action: 'remover', member_id: p.id }); closeSheet(); toast('Membro removido.'); await reload(); } catch (e) { toast(errMsg(e)); }
        });
      });
    });
  };
  A.hideInstall = () => { installHidden = true; try { localStorage.setItem('louvor-install-hidden', '1'); } catch (e) { /* ok */ } route(); };
  A.install = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* ok */ } installEvt = null; route(); };
  A.authTab = (el) => { authTab = el.dataset.t; route(); };

  /* Modo palco: rolagem, tamanho, tema, tela sempre acesa */
  let raf = null, lastT = 0, wake = null;
  function mountStage() {
    const sc = document.getElementById('stage-scroll'), bar = document.getElementById('stage-bar');
    const upd = () => { const max = sc.scrollHeight - sc.clientHeight; bar.style.width = (max > 0 ? (sc.scrollTop / max) * 100 : 0) + '%'; };
    sc.addEventListener('scroll', upd, { passive: true }); upd();
    if (stage.playing) startScroll();
    requestWake();
  }
  function startScroll() {
    const sc = document.getElementById('stage-scroll');
    if (!sc) return;
    let acc = 0; lastT = 0;
    const step = (t) => {
      if (!lastT) lastT = t;
      acc += ((t - lastT) / 1000) * 22 * stage.speed; lastT = t;
      if (acc >= 1) { const px = Math.floor(acc); sc.scrollTop += px; acc -= px; }
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) { stage.playing = false; rerenderStageCtrl(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stopScroll() { if (raf) cancelAnimationFrame(raf); raf = null; }
  function rerenderStageCtrl() {
    const b = document.querySelector('[data-act="stagePlay"]');
    if (b) { b.innerHTML = ic(stage.playing ? 'pause' : 'play'); b.setAttribute('aria-label', stage.playing ? 'Pausar' : 'Rolar'); }
  }
  async function requestWake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ok */ } wake = null; }
  A.stagePlay = () => { stage.playing = !stage.playing; rerenderStageCtrl(); stage.playing ? startScroll() : stopScroll(); };
  A.stageSpeed = (el) => { const sp = [0.5, 0.75, 1, 1.25, 1.5, 2]; stage.speed = sp[(sp.indexOf(stage.speed) + 1) % sp.length]; el.textContent = fmtSpeed(stage.speed); };
  A.stageSize = () => { stage.size = (stage.size + 1) % 4; document.getElementById('stage-scroll').style.fontSize = [18, 22, 27, 33][stage.size] + 'px'; };
  A.stageLight = () => { stage.light = !stage.light; document.getElementById('stage').classList.toggle('light', stage.light); };

  function mountSongSearch() {
    const inp = document.getElementById('song-q');
    inp.addEventListener('input', () => {
      songQuery = inp.value;
      const pos = inp.selectionStart;
      route();
      const n = document.getElementById('song-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ok */ }
    });
  }

  /* Delegação de eventos */
  document.addEventListener('click', (ev) => {
    if (ev.target.matches('[data-sheet-back]')) { closeSheet(); return; }
    const el = ev.target.closest('[data-act], [data-go]');
    if (!el || el.disabled) return;
    if (el.dataset.act && A[el.dataset.act]) { ev.preventDefault(); A[el.dataset.act](el); return; }
    if (el.dataset.go) { ev.preventDefault(); closeSheet(); go(el.dataset.go); }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target, a = el.dataset.actChange;
    if (!a) return;
    if (a === 'switchEvent') go('#/montar/' + el.value);
    if (a === 'shareOpt') { shareOpts[el.dataset.k] = el.checked; rerender(); }
  });
  document.addEventListener('submit', async (ev) => {
    const f = ev.target;
    const kind = f.dataset.form;
    if (!kind) return;
    ev.preventDefault();
    const btn = f.querySelector('[type="submit"]');
    const val = (id) => f.querySelector('#' + id).value.trim();
    if (kind === 'aviso') {
      const t = val('aviso-txt');
      if (!t) return;
      btn.disabled = true;
      await act(() => sb.from('notices').insert({ text: t, author_name: me().name }), 'Aviso publicado no mural.');
      btn.disabled = false;
    }
    if (kind === 'perfil') {
      const name = val('pf-name');
      if (!name) { toast('Informe seu nome.'); return; }
      const skills = Array.from(f.querySelectorAll('#pf-skills .chip.on')).map((c) => c.dataset.skill);
      btn.disabled = true;
      await act(() => sb.from('members').update({ name, skills, fem: f.querySelector('#pf-fem').value === '1' }).eq('id', S.meId), 'Perfil salvo.');
      btn.disabled = false;
    }
    if (kind === 'login') {
      btn.disabled = true; btn.textContent = 'Entrando…';
      const { error } = await sb.auth.signInWithPassword({ email: val('lg-email').toLowerCase(), password: f.querySelector('#lg-pw').value });
      if (error) { btn.disabled = false; btn.textContent = 'Entrar'; toast(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : errMsg(error)); }
      else location.hash = '#/';
    }
    if (kind === 'signup') {
      btn.disabled = true; btn.textContent = 'Criando conta…';
      const email = val('su-email').toLowerCase(), password = f.querySelector('#su-pw').value;
      try {
        const r = await callConta({ action: 'entrar', name: val('su-name'), email, password, code: val('su-code') });
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast(r && r.leader ? 'Conta criada. Você é o primeiro líder do ministério.' : 'Conta criada. Marque suas funções no Perfil.');
        location.hash = r && r.leader ? '#/equipe' : '#/perfil';
      } catch (e) { btn.disabled = false; btn.textContent = 'Criar conta'; toast(errMsg(e)); }
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeSheet();
    if (document.body.classList.contains('stage') && ev.key === ' ' && !ev.target.closest('button')) { ev.preventDefault(); A.stagePlay(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (document.body.classList.contains('stage')) requestWake();
    else if (session) reload();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', sizePlayer);
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  window.addEventListener('online', () => session && reload());

  /* Tempo real: quando alguém muda algo, todos veem */
  let channel = null, rtTimer = null;
  function subscribe() {
    if (channel) return;
    channel = sb.channel('louvor')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => { clearTimeout(rtTimer); rtTimer = setTimeout(reload, 500); })
      .subscribe();
  }
  function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }

  /* Início */
  function hideSplash() {
    if (!booting) return;
    booting = false;
    const sp = document.getElementById('splash');
    if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); }
  }
  async function onSession(s) {
    const changedUser = (session && session.user.id) !== (s && s.user.id);
    session = s;
    if (!s) { S = null; unsubscribe(); route(); hideSplash(); return; }
    if (!changedUser && S) return;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c && c.uid === s.user.id) S = c.S; else S = null;
    } catch (e) { S = null; }
    route(); if (S) hideSplash();
    try { await fetchAll(); } catch (e) { if (!S) { toast(errMsg(e)); } }
    route(); hideSplash();
    subscribe();
  }
  document.getElementById('splash-logo').src = LOGO;
  sb.auth.onAuthStateChange((evt, s) => { setTimeout(() => onSession(s), 0); });
  setTimeout(hideSplash, 2500);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
