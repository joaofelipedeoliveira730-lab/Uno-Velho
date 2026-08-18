# UNO50 — Relatório de testes 3.2.0

## Resultado
**PASS na bateria automatizada disponível neste ambiente.**

### Correções críticas
1. Corrigido o fechamento de `chooseColor()` em `app.js`. O listener `DOMContentLoaded` estava dentro do escopo errado e o `init()` não era executado corretamente.
2. Login/register agora usam sessão por cookie HttpOnly e não devolvem JWT ao navegador JavaScript.
3. Produção exige `JWT_SECRET` com pelo menos 32 caracteres.
4. Arquivos internos do projeto deixaram de ser publicados pelo servidor HTTP.
5. Cache offline deixou de bloquear o boot; mapas podem ser carregados sob demanda.
6. Reconexão de sala foi implementada para troca de orientação/reload.
7. Watchdog de turno impede partida online de ficar travada.
8. +2/+4 são validados no servidor.

### Bateria
- JavaScript: `node --check app.js` — PASS
- Servidor: `node --check server.js` — PASS
- Online: 140 simulações — PASS
  - 2, 3, 4, 5, 6, 7 e 8 jogadores
  - empilhamento desativado e ativado
  - sem vencedor ausente, índice de turno inválido ou falta de progresso
- Solo: 150 simulações — PASS
  - 50 Fácil, 50 Médio, 50 Difícil
- Baralho: 108 cartas / 108 IDs únicos — PASS
- Segurança estática: URL, JWT, cookie, CORS, arquivos publicados, reconexão e timeout — PASS

## Limitação
`npm install` excedeu o tempo limite de rede deste ambiente. Por isso, o teste final de integração com as versões reais de Express/Socket.IO/PostgreSQL deve ser feito no Render.
