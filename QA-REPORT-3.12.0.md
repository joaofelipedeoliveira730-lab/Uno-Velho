# UNO50 3.12.0 — QA de ZIP sem pastas

## Resultado

- Estrutura: PASS — 0 subpastas.
- Sintaxe server.js: PASS (`node --check`).
- Sintaxe app.js: PASS (`node --check`).
- Sintaxe migrate.js: PASS (`node --check`).
- Sintaxe service-worker.js: PASS (`node --check`).
- Manifest JSON: PASS.
- Recursos do manifest ausentes: 0.
- Referências `assets/` em código executável: 0.
- Referências antigas UnoVelho/Matematixa/MATX em código executável: 0.
- Referências SVG quebradas: 0.
- Referências client-side a `isBot`, `botPersona` ou `botStyle`: 0.
- Arquivos duplicados de QA/preview removidos.

## Correção principal desta versão

O ZIP anterior foi achatado sem atualizar as rotas. O frontend ainda apontava para `/assets/...`, enquanto os SVGs estavam na raiz. Isso causaria 404 e falhas visuais.

Correções aplicadas:

1. Todos os mapas e acessórios agora são referenciados pela raiz (`/pirate.svg`, `/pharaoh-crown.svg`, etc.).
2. `manifest.json` agora usa somente caminhos raiz válidos.
3. O Service Worker agora usa `/manifest.json`.
4. O servidor deixou de depender da pasta `assets/`.
5. O servidor possui uma allowlist para servir somente SVG/JSON da raiz, evitando expor arquivos sensíveis via static global.
6. A referência a áudio inexistente foi tornada opcional; o fallback Web Audio continua disponível.
7. Nenhuma subpasta permanece no ZIP.

## Limitação

As dependências npm não estão instaladas neste ambiente (`node_modules` ausente). Portanto a execução real de Express + Socket.IO + PostgreSQL não pôde ser realizada aqui. A validação de sintaxe, rotas estáticas, manifest, referências e integridade estrutural foi realizada.
