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
