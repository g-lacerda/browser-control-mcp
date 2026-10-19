# Privacidade · Claude no Navegador

**Resumo:** a extensão não manda nada pra internet. Ela só conversa com o servidor MCP que roda no seu próprio computador (localhost), e isso é imposto pela política de segurança da própria extensão.

## O que a extensão lê
- O conteúdo, os elementos, o console e as requisições de rede **das abas que o Claude abriu** (grupo "Claude"). As suas abas não são lidas, listadas nem fotografadas.
- O histórico de navegação **só se você ligar** essa ferramenta nas opções (vem desligada).

## Pra onde vai
- Da extensão para o servidor MCP local, por uma conexão com mensagens assinadas por uma chave secreta.
- Do servidor local para o Claude Code, que você instalou e que envia o conteúdo para a Anthropic conforme os termos e a política de privacidade da Anthropic.

## O que fica guardado
- No próprio Firefox: a chave secreta, o modo de autorização, os sites liberados ou bloqueados e um registro das últimas 100 ações (ferramenta, horário e site). Nada disso sai do seu computador.

## Sem
- Sem telemetria, sem rastreamento, sem servidor do desenvolvedor, sem venda ou compartilhamento de dados.

Código aberto: https://github.com/g-lacerda/browser-control-mcp
