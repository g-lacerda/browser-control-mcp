/*
 * Ler um arquivo do computador pra enviar num campo de upload da pagina. Quem
 * le e este servidor local; o conteudo so sai da maquina quando o site recebe
 * o upload, como se a pessoa tivesse escolhido o arquivo na mao.
 *
 * Travas que valem sempre, independente do que a extensao autorizar:
 * nada oculto (nenhum pedaco do caminho comecando com "."), nada com cara de
 * chave ou segredo, so arquivo comum (sem pasta, sem atalho pra fora) e no
 * maximo 25 MB.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

export const TAMANHO_MAXIMO = 25 * 1024 * 1024;

const NOMES_PROIBIDOS = [
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i,
  /^(credentials|secrets?)(\.\w+)?$/i,
  /\.env(\.\w+)?$/i,
  /^known_hosts$/i,
  /^shadow$|^passwd$/i,
];

const TIPOS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
};

export function tipoDoArquivo(nome: string): string {
  return TIPOS[path.extname(nome).toLowerCase()] ?? "application/octet-stream";
}

/* o caminho (ja resolvido) passa nas travas? devolve o motivo quando nao */
export function motivoDeRecusa(caminho: string): string | null {
  const partes = caminho.split(path.sep).filter(Boolean);
  if (partes.some((p) => p.startsWith("."))) {
    return "arquivos e pastas ocultos (que comecam com ponto) nunca sao enviados";
  }
  const nome = partes[partes.length - 1] ?? "";
  if (NOMES_PROIBIDOS.some((r) => r.test(nome))) {
    return "isso parece uma chave ou um segredo, e nunca e enviado";
  }
  return null;
}

export interface ArquivoLido {
  nome: string;
  tipo: string;
  tamanho: number;
  base64: string;
}

export async function lerArquivo(caminhoPedido: string): Promise<ArquivoLido> {
  const expandido = caminhoPedido.startsWith("~") ? path.join(os.homedir(), caminhoPedido.slice(1)) : caminhoPedido;
  if (!path.isAbsolute(expandido)) {
    throw new Error("Use o caminho completo do arquivo (ex.: /home/voce/Imagens/foto.jpg)");
  }
  // realpath resolve atalhos: a trava vale pro arquivo de verdade, nao pro nome do atalho
  const real = await fs.realpath(expandido).catch(() => {
    throw new Error(`Arquivo nao encontrado: ${caminhoPedido}`);
  });
  const motivo = motivoDeRecusa(real) ?? motivoDeRecusa(path.resolve(expandido));
  if (motivo) throw new Error(`Recusado: ${motivo}.`);
  const info = await fs.stat(real);
  if (!info.isFile()) throw new Error("So da pra enviar arquivo, nao pasta");
  if (info.size > TAMANHO_MAXIMO) throw new Error("Arquivo maior que 25 MB");
  const conteudo = await fs.readFile(real);
  const nome = path.basename(real);
  return { nome, tipo: tipoDoArquivo(nome), tamanho: info.size, base64: conteudo.toString("base64") };
}
