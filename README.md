# Louvor ICVJ · webapp

Webapp (PWA) do Ministério de Louvor da ICVJ, feito a partir das telas do Figma
(arquivo 9aY8WQ0OlDU6XQsmHCuwxH) e da paleta verde da logo da igreja.

## Telas
Início (próxima escala com Confirmar / Não posso), Escalas, Escala do culto, Montar escala (líder),
Minha disponibilidade, Músicas, Cifra (com transposição de tom), Modo palco (rolagem automática,
tela sempre acesa), Compartilhar no WhatsApp, Avisos (mural) e Perfil.

## Como rodar
Não há build. Sirva a pasta com qualquer servidor estático:

    python3 -m http.server 8080

e abra http://localhost:8080. No celular, "Adicionar à tela inicial" instala o app.

## Arquivos
- `index.html`: casca do app
- `styles.css`: estilos e variáveis de cor (mesmos nomes da coleção "Cores" do Figma)
- `config.js`: endereço do banco Supabase e a chave publicável
- `app.js`: telas, rotas (`#/escala/:id`, `#/cifra/:id/:tom`, ...) e ações
- `sw.js` + `manifest.webmanifest`: instalação e uso offline


## Contas e dados
Os dados ficam no Supabase (veja `supabase/README.md`) e aparecem para todos em tempo real.
Cada membro cria a conta no próprio app com nome, e-mail, senha e o **código do ministério**,
que o líder vê e compartilha em Perfil > Equipe e convites. A primeira pessoa a se cadastrar
quando não há líder vira líder. Senha esquecida: o líder gera uma senha temporária.
