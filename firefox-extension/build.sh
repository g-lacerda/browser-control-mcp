#!/usr/bin/env bash
# Compila a extensao. MODO_PADRAO=autonomo deixa o Claude agir sem perguntar
# (padrao: perguntar por site). SEGREDO_INICIAL combina a chave com o servidor
# na instalacao; nunca vai pro git (dist e ignorado).
set -euo pipefail
cd "$(dirname "$0")"
DEF=(--define:__MODO_PADRAO__="\"${MODO_PADRAO:-perguntar}\"" --define:__SEGREDO_INICIAL__="\"${SEGREDO_INICIAL:-}\"")
for f in background options popup agente-pagina aprovar-arquivo; do
  npx esbuild "$f.ts" --bundle --log-level=warning --outfile="dist/$f.js" "${DEF[@]}"
done
