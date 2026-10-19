import {
  digitosDoTexto,
  dominioNaLista,
  ehCampoDeCartao,
  ehCartaoReal,
  passaNoLuhn,
  urlPermitida,
} from "../regras";

describe("cartao", () => {
  it("cartao de teste do sandbox passa", () => {
    expect(ehCartaoReal("4242 4242 4242 4242")).toBe(false);
    expect(ehCartaoReal("5031-4332-1540-6351")).toBe(false);
  });

  it("numero com cara de cartao real e recusado", () => {
    // passa no Luhn e nao esta na lista de teste
    expect(passaNoLuhn("4539578763621486")).toBe(true);
    expect(ehCartaoReal("4539 5787 6362 1486")).toBe(true);
  });

  it("texto comum, telefone e CPF nao contam como cartao", () => {
    expect(ehCartaoReal("31999990000")).toBe(false);
    expect(ehCartaoReal("123.456.789-09")).toBe(false);
    expect(ehCartaoReal("minha senha 123")).toBe(false);
    expect(digitosDoTexto("abc")).toBeNull();
  });

  it("campo de cartao pelo autocomplete ou pelo nome", () => {
    expect(ehCampoDeCartao({ autocomplete: "cc-number" })).toBe(true);
    expect(ehCampoDeCartao({ name: "numeroCartao" })).toBe(true);
    expect(ehCampoDeCartao({ id: "card-number" })).toBe(true);
    expect(ehCampoDeCartao({ name: "email" })).toBe(false);
  });
});

describe("enderecos", () => {
  it("so http e https", () => {
    expect(urlPermitida("https://calourada.com")).toBe(true);
    expect(urlPermitida("http://127.0.0.1:4100")).toBe(true);
    expect(urlPermitida("file:///etc/passwd")).toBe(false);
    expect(urlPermitida("javascript:alert(1)")).toBe(false);
    expect(urlPermitida("about:config")).toBe(false);
    expect(urlPermitida("moz-extension://x/options.html")).toBe(false);
    expect(urlPermitida("nao e url")).toBe(false);
  });

  it("dominio e subdominio na lista", () => {
    const lista = ["itau.com.br", " Nubank.com.br "];
    expect(dominioNaLista("https://www.itau.com.br/x", lista)).toBe(true);
    expect(dominioNaLista("https://app.nubank.com.br", lista)).toBe(true);
    expect(dominioNaLista("https://notitau.com.br", lista)).toBe(false);
    expect(dominioNaLista("lixo", lista)).toBe(false);
  });
});
