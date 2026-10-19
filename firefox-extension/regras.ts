/*
 * Regras de seguranca que nao dependem do navegador, pra poderem ser testadas
 * sozinhas: o que conta como cartao de verdade, que endereco o Claude pode
 * abrir e se um dominio esta numa lista.
 */

/*
 * Cartoes de teste publicados pelos provedores (sandbox). So estes podem ser
 * digitados: qualquer outro numero com cara de cartao e recusado.
 */
export const CARTOES_DE_TESTE = new Set<string>([
  // Stripe
  "4242424242424242",
  "4000056655665556",
  "5555555555554444",
  "2223003122003222",
  "5200828282828210",
  "5105105105105100",
  "378282246310005",
  "371449635398431",
  "6011111111111117",
  "6011000990139424",
  "3056930009020004",
  "36227206271667",
  "3566002020360505",
  "6200000000000005",
  "4000000000000002",
  "4000000000009995",
  "4000002500003155",
  "4000000000003220",
  "4000000000000077",
  // Mercado Pago
  "5031433215406351",
  "4235647728025682",
  "375365153556885",
  "5067766783888311",
  // Asaas (sandbox)
  "5162306219378829",
  "4444444444444448",
  // Pagar.me / Cielo (sandbox)
  "4000000000000010",
  "4111111111111111",
  "5448280000000007",
]);

/* digitos de um texto, se ele for so numero com espaco, ponto ou traco */
export function digitosDoTexto(texto: string): string | null {
  if (!/^[\d\s.\-]+$/.test(texto)) return null;
  return texto.replace(/\D/g, "");
}

/* algoritmo de Luhn: todo numero de cartao valido passa nele */
export function passaNoLuhn(digitos: string): boolean {
  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i]);
    if (dobrar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobrar = !dobrar;
  }
  return digitos.length > 0 && soma % 10 === 0;
}

/*
 * Numero com cara de cartao de verdade: 13 a 19 digitos, passa no Luhn e nao
 * esta na lista de teste. Estes nunca sao digitados.
 */
export function ehCartaoReal(texto: string): boolean {
  const digitos = digitosDoTexto(texto.trim());
  if (!digitos || digitos.length < 13 || digitos.length > 19) return false;
  if (!passaNoLuhn(digitos)) return false;
  return !CARTOES_DE_TESTE.has(digitos);
}

/*
 * Campo de cartao pelo que o proprio site declara (autocomplete cc-*) ou pelo
 * nome. Num campo assim so entra cartao de teste.
 */
export function ehCampoDeCartao(atributos: {
  autocomplete?: string | null;
  name?: string | null;
  id?: string | null;
}): boolean {
  if ((atributos.autocomplete ?? "").toLowerCase().startsWith("cc-number")) return true;
  const nome = `${atributos.name ?? ""} ${atributos.id ?? ""}`.toLowerCase();
  return /(card.?number|cardnumber|cc.?num|numero.?(do.?)?cartao|cartao.?numero|credit.?card)/.test(nome);
}

/*
 * Endereco que o Claude pode abrir: http e https. Nada de file:, data:,
 * javascript:, about: nem paginas internas do Firefox ou de extensoes.
 */
export function urlPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/* o dominio esta na lista (ele mesmo ou um subdominio dele) */
export function dominioNaLista(url: string, lista: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return lista.some((d) => {
    const dominio = d.trim().toLowerCase();
    return dominio !== "" && (host === dominio || host.endsWith(`.${dominio}`));
  });
}
