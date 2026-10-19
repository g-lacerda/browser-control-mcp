# Como compilar (para a revisão da Mozilla)

Requisitos: Node.js 20+ e npm.

```
npm install
cd firefox-extension
bash build.sh
```

O `build.sh` usa o esbuild pra juntar `background.ts`, `options.ts`, `popup.ts` e `agente-pagina.ts` em `dist/`. Sem variáveis de ambiente, sai a versão pública: modo "perguntar por site" e chave secreta gerada na instalação. O pacote enviado é a pasta `firefox-extension` sem `node_modules`, `__tests__`, os `.ts` e os arquivos de configuração.

Testes: `cd firefox-extension && npx jest`.
