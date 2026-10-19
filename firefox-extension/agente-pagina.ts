/*
 * Roda dentro da aba (content script), so nas abas do grupo do Claude. Le a
 * pagina como uma lista de elementos com referencia (e1, e2...), e clica,
 * digita, rola e escolhe opcao por essas referencias. A background injeta este
 * arquivo uma vez por pagina e depois chama window.__claudeAgente.
 *
 * Nada aqui fala com a rede: o resultado volta so pra background da extensao.
 */
import { CARTOES_DE_TESTE, digitosDoTexto, ehCampoDeCartao, ehCartaoReal } from "./regras";

declare function exportFunction(fn: Function, alvo: object, opcoes?: { defineAs?: string }): Function;

const SELETOR_INTERATIVO = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[contenteditable=''], [contenteditable=true]",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=combobox]",
  "[role=textbox]",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SELETOR_TEXTO = "h1,h2,h3,h4,h5,h6,p,li,label,td,th,[role=heading],[role=alert],[role=status]";

let proximaRef = 1;
let porRef = new Map<string, Element>();

interface EntradaConsole {
  level: string;
  text: string;
  timestamp: number;
}
const consoleCapturado: EntradaConsole[] = [];
let capturandoConsole = false;

function visivel(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const estilo = window.getComputedStyle(el);
  return estilo.visibility !== "hidden" && estilo.display !== "none" && estilo.opacity !== "0";
}

function curto(texto: string | null | undefined, max = 80): string {
  const limpo = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

function nomeDoElemento(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return curto(aria);
  const rotuladoPor = el.getAttribute("aria-labelledby");
  if (rotuladoPor) {
    const texto = rotuladoPor
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (texto.trim()) return curto(texto);
  }
  if (el.id) {
    const rotulo = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (rotulo?.textContent?.trim()) return curto(rotulo.textContent);
  }
  const pai = el.closest("label");
  if (pai && pai !== el && pai.textContent?.trim()) return curto(pai.textContent);
  for (const atributo of ["placeholder", "title", "alt", "name"]) {
    const valor = el.getAttribute(atributo);
    if (valor) return curto(valor);
  }
  return curto((el as HTMLElement).innerText ?? el.textContent);
}

function papelDoElemento(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "input") {
    const tipo = (el as HTMLInputElement).type;
    if (tipo === "checkbox" || tipo === "radio") return tipo;
    if (tipo === "submit" || tipo === "button" || tipo === "reset") return "button";
    return `textbox (${tipo})`;
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if ((el as HTMLElement).isContentEditable) return "textbox (editavel)";
  return tag;
}

function estadoDoElemento(el: Element): string {
  const partes: string[] = [];
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") partes.push(el.checked ? "marcado" : "desmarcado");
    // o valor de senha nunca sai da pagina
    else if (el.type !== "password" && el.value) partes.push(`valor: "${curto(el.value, 40)}"`);
    else if (el.type === "password" && el.value) partes.push("preenchido");
  } else if (el instanceof HTMLTextAreaElement && el.value) {
    partes.push(`valor: "${curto(el.value, 40)}"`);
  } else if (el instanceof HTMLSelectElement) {
    partes.push(`escolhido: "${curto(el.selectedOptions[0]?.textContent, 40)}"`);
  }
  if ((el as HTMLButtonElement).disabled) partes.push("desabilitado");
  if (el.getAttribute("aria-expanded")) partes.push(`expandido=${el.getAttribute("aria-expanded")}`);
  if (el instanceof HTMLAnchorElement && el.href) partes.push(`href=${curto(el.href, 100)}`);
  return partes.length ? ` (${partes.join(", ")})` : "";
}

function registrar(el: Element): string {
  const ref = `e${proximaRef++}`;
  porRef.set(ref, el);
  return ref;
}

function lerPagina(soInterativos: boolean): string {
  proximaRef = 1;
  porRef = new Map();
  const linhas: string[] = [];
  const seletor = soInterativos ? SELETOR_INTERATIVO : `${SELETOR_INTERATIVO},${SELETOR_TEXTO}`;
  const vistos = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll(seletor))) {
    if (vistos.has(el) || !visivel(el)) continue;
    vistos.add(el);
    if (el.matches(SELETOR_INTERATIVO)) {
      linhas.push(`[${registrar(el)}] ${papelDoElemento(el)} "${nomeDoElemento(el)}"${estadoDoElemento(el)}`);
    } else {
      // texto solto: so se nao for dentro de um interativo ja listado
      if (el.closest(SELETOR_INTERATIVO)) continue;
      const texto = curto((el as HTMLElement).innerText, 200);
      if (texto) linhas.push(`${el.tagName.toLowerCase()}: ${texto}`);
    }
    if (linhas.length >= 1500) {
      linhas.push("… (pagina grande: lista cortada em 1500 itens)");
      break;
    }
  }
  return linhas.join("\n");
}

function alvo(ref?: string, seletor?: string, x?: number, y?: number): Element {
  let el: Element | null | undefined = null;
  if (ref) {
    el = porRef.get(ref);
    if (!el || !el.isConnected) throw new Error(`A referencia ${ref} nao existe mais na pagina. Leia a pagina de novo (snapshot).`);
  } else if (seletor) {
    el = document.querySelector(seletor);
    if (!el) throw new Error(`Nenhum elemento com o seletor ${seletor}`);
  } else if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`Nenhum elemento no ponto (${x}, ${y})`);
  } else {
    throw new Error("Diga o elemento: ref, selector ou x/y");
  }
  return el;
}

function eventoDeMouse(el: Element, tipo: string) {
  const r = el.getBoundingClientRect();
  const opcoes = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  const Construtor = tipo.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  el.dispatchEvent(new Construtor(tipo, opcoes));
}

function clicar(ref?: string, seletor?: string, x?: number, y?: number, duplo = false): string {
  const el = alvo(ref, seletor, x, y);
  el.scrollIntoView({ block: "center", inline: "center" });
  for (const tipo of ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown"]) eventoDeMouse(el, tipo);
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  for (const tipo of ["pointerup", "mouseup"]) eventoDeMouse(el, tipo);
  if (el instanceof HTMLElement) el.click();
  else eventoDeMouse(el, "click");
  if (duplo) eventoDeMouse(el, "dblclick");
  return `Cliquei em ${papelDoElemento(el)} "${nomeDoElemento(el)}"`;
}

/* muda o valor do jeito que React e afins enxergam (setter nativo + eventos) */
function definirValor(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
  if (setter) setter.call(el, valor);
  else el.value = valor;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function conferirCartao(el: Element, texto: string) {
  if (ehCartaoReal(texto)) {
    throw new Error("Recusado: isso parece um cartao de verdade. So cartoes de teste (sandbox) podem ser digitados.");
  }
  const campoDeCartao = ehCampoDeCartao({
    autocomplete: el.getAttribute("autocomplete"),
    name: el.getAttribute("name"),
    id: el.id,
  });
  if (campoDeCartao) {
    const digitos = digitosDoTexto(texto.trim());
    if (!digitos || !CARTOES_DE_TESTE.has(digitos)) {
      throw new Error("Recusado: campo de numero de cartao so aceita cartao de teste (sandbox).");
    }
  }
}

function digitar(texto: string, ref?: string, seletor?: string, limpar = true, enviar = false): string {
  const el = alvo(ref, seletor);
  conferirCartao(el, texto);
  el.scrollIntoView({ block: "center" });
  if (el instanceof HTMLElement) el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    definirValor(el, limpar ? texto : el.value + texto);
  } else if ((el as HTMLElement).isContentEditable) {
    if (limpar) (el as HTMLElement).textContent = "";
    document.execCommand("insertText", false, texto);
  } else {
    throw new Error(`O elemento ${papelDoElemento(el)} nao recebe texto`);
  }
  if (enviar) apertarTecla("Enter");
  return `Digitei em ${papelDoElemento(el)} "${nomeDoElemento(el)}"${enviar ? " e enviei" : ""}`;
}

const FOCAVEIS = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

function apertarTecla(tecla: string): string {
  const el = (document.activeElement as HTMLElement | null) ?? document.body;
  const opcoes = { key: tecla, code: tecla.length === 1 ? `Key${tecla.toUpperCase()}` : tecla, bubbles: true, cancelable: true };
  const naoCancelado = el.dispatchEvent(new KeyboardEvent("keydown", opcoes));
  el.dispatchEvent(new KeyboardEvent("keypress", opcoes));
  el.dispatchEvent(new KeyboardEvent("keyup", opcoes));
  if (naoCancelado) {
    // evento sintetico nao faz o padrao do navegador: Enter e Tab feitos a mao
    if (tecla === "Enter" && el instanceof HTMLInputElement && el.form) el.form.requestSubmit();
    if (tecla === "Tab") {
      const focaveis = Array.from(document.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(visivel);
      const i = focaveis.indexOf(el);
      focaveis[(i + 1) % focaveis.length]?.focus();
    }
  }
  return `Apertei ${tecla}`;
}

function rolar(ref?: string, direcao: "up" | "down" | "left" | "right" = "down", quantidade = 3): string {
  if (ref) {
    const el = alvo(ref);
    el.scrollIntoView({ block: "center" });
    return `Rolei ate ${papelDoElemento(el)} "${nomeDoElemento(el)}"`;
  }
  const passo = 120 * quantidade;
  const dx = direcao === "left" ? -passo : direcao === "right" ? passo : 0;
  const dy = direcao === "up" ? -passo : direcao === "down" ? passo : 0;
  window.scrollBy({ left: dx, top: dy });
  return `Rolei ${direcao} (${passo}px)`;
}

function escolherOpcao(valor: string, ref?: string, seletor?: string): string {
  const el = alvo(ref, seletor);
  if (!(el instanceof HTMLSelectElement)) throw new Error("Esse elemento nao e uma lista de opcoes (select)");
  const opcao = Array.from(el.options).find((o) => o.value === valor || curto(o.textContent) === curto(valor));
  if (!opcao) throw new Error(`Opcao "${valor}" nao existe nessa lista`);
  el.value = opcao.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `Escolhi "${curto(opcao.textContent)}"`;
}

/*
 * Console da pagina: o content script vive num mundo isolado, entao embrulha o
 * console da propria pagina (wrappedJSObject + exportFunction, do Firefox). So
 * comeca a guardar a partir do primeiro pedido.
 */
function iniciarConsole() {
  if (capturandoConsole) return;
  capturandoConsole = true;
  const pagina = (window as unknown as { wrappedJSObject: Window & { console: Console } }).wrappedJSObject;
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
    const original = pagina.console[nivel];
    exportFunction(
      function (...args: unknown[]) {
        consoleCapturado.push({ level: nivel, text: args.map((a) => curto(String(a), 500)).join(" "), timestamp: Date.now() });
        if (consoleCapturado.length > 500) consoleCapturado.shift();
        return original.apply(pagina.console, args);
      },
      pagina.console,
      { defineAs: nivel },
    );
  }
  window.addEventListener("error", (e) => {
    consoleCapturado.push({ level: "error", text: `${e.message} (${e.filename}:${e.lineno})`, timestamp: Date.now() });
  });
}

function lerConsole(padrao?: string, limpar = false) {
  iniciarConsole();
  const regex = padrao ? new RegExp(padrao, "i") : null;
  const entradas = consoleCapturado.filter((e) => !regex || regex.test(e.text));
  if (limpar) consoleCapturado.length = 0;
  return { entries: entradas.slice(-200), capturing: true };
}

(window as unknown as { __claudeAgente: unknown }).__claudeAgente = {
  lerPagina,
  clicar,
  digitar,
  apertarTecla,
  rolar,
  escolherOpcao,
  lerConsole,
};
