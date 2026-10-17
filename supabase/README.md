# Banco (Supabase)

Projeto Supabase: `louvor-icvj` (ref `bwvghffgyfevjstbxfce`, região São Paulo).

Tabelas: `members`, `songs`, `events`, `assignments`, `unavailability`, `notices` e `settings`
(código de convite, só acessível pelo servidor). Todas com RLS:
- membros (quem tem linha em `members`) leem tudo;
- só líderes criam/editam cultos, escalas e avisos, e removem músicas;
- cada membro confirma a própria escala pela função `set_my_status` e marca a própria indisponibilidade;
- `is_leader` só muda por um líder, e sempre fica pelo menos um líder.

A função `functions/conta` cria contas com o código do ministério (sem e-mail de confirmação)
e faz as ações do líder: senha temporária, remover membro.

## Repertório por ministro

Tabela `repertoire` (member_id, song_id, key): cada ministro guarda as músicas que canta e o tom dele. Todos os membros leem; cada um edita o próprio repertório e líderes editam o de qualquer pessoa. Substitui o antigo `songs.pref` (que não é mais usado pelo app).

## Notificações push

- Tabela `push_subscriptions`: um registro por aparelho que ativou as notificações (cada membro só vê e apaga os próprios).
- Chaves VAPID e o segredo do agendamento ficam em `private.push_config` (fora da API). A chave pública também está em `config.js`.
- Função `functions/notificar`: envia as notificações (escalado, escala publicada, não posso servir, aviso novo, teste).
- `pg_cron` roda `private.disparar_lembrete()` todo dia às 20h de Brasília: lembrete para quem serve no dia seguinte.
