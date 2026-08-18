# UNO50 3.14.0 — QA

## Correção crítica
- Cache-busting do app.js atualizado para 20260818-3.14.
- Registro do Service Worker agora usa `/service-worker.js?v=20260818-3.14` para romper cache antigo.
- Service Worker atualizado para cache uno50-v20260818-3.14.
- Versões antigas 3.11/3.12/3.13 removidas das referências executáveis.
- CORE do Service Worker agora inclui app.js com query e sem query.

## Frontend
- Seleção de plataforma usa delegação global de clique como fallback.
- Modal de plataforma é aberto antes do editor de personagem.
- Seleção mobile/desktop + retrato/paisagem grava localStorage e fecha o modal.
- Reconexão Socket.IO configurada com 12 tentativas e backoff.
- Cancelamento de matchmaking limpa timer/overlay e volta ao menu.

## Validações
- node --check server.js: PASS
- node --check app.js: PASS
- node --check migrate.js: PASS
- manifest JSON: PASS
- referências de cache antigas: PASS (nenhuma)
- referências assets/: PASS (nenhuma)
- estrutura do ZIP: PASS

## Limitação
- Execução real PostgreSQL/Socket.IO não foi possível neste ambiente porque npm install excedeu o timeout.
