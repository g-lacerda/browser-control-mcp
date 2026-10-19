export interface ServerMessageBase {
  cmd: string;
}

export interface OpenTabServerMessage extends ServerMessageBase {
  cmd: "open-tab";
  url: string;
}

export interface CloseTabsServerMessage extends ServerMessageBase {
  cmd: "close-tabs";
  tabIds: number[];
}

export interface GetTabListServerMessage extends ServerMessageBase {
  cmd: "get-tab-list";
}

export interface GetBrowserRecentHistoryServerMessage extends ServerMessageBase {
  cmd: "get-browser-recent-history";
  searchQuery?: string;
}

export interface GetTabContentServerMessage extends ServerMessageBase {
  cmd: "get-tab-content";
  tabId: number;
  offset?: number;
}

export interface ReorderTabsServerMessage extends ServerMessageBase {
  cmd: "reorder-tabs";
  tabOrder: number[];
}

export interface FindHighlightServerMessage extends ServerMessageBase {
  cmd: "find-highlight";
  tabId: number;
  queryPhrase: string;
}

export interface GroupTabsServerMessage extends ServerMessageBase {
  cmd: "group-tabs";
  tabIds: number[];
  isCollapsed: boolean;
  groupColor: string;
  groupTitle: string;
}

export interface CaptureScreenshotServerMessage extends ServerMessageBase {
  cmd: "capture-screenshot";
  tabId: number;
  format?: "jpeg" | "png";
  quality?: number;
  scale?: number;
}

/* ── agir na pagina (so nas abas do grupo do Claude) ── */

export interface NavigateServerMessage extends ServerMessageBase {
  cmd: "navigate";
  tabId: number;
  // URL, ou "back" / "forward" / "reload"
  url: string;
}

export interface SnapshotServerMessage extends ServerMessageBase {
  cmd: "snapshot";
  tabId: number;
  // so os elementos interativos, ou a pagina toda
  interactiveOnly?: boolean;
}

export interface ClickServerMessage extends ServerMessageBase {
  cmd: "click";
  tabId: number;
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  double?: boolean;
}

export interface TypeServerMessage extends ServerMessageBase {
  cmd: "type";
  tabId: number;
  ref?: string;
  selector?: string;
  text: string;
  clear?: boolean;
  submit?: boolean;
}

export interface PressKeyServerMessage extends ServerMessageBase {
  cmd: "press-key";
  tabId: number;
  key: string;
}

export interface ScrollServerMessage extends ServerMessageBase {
  cmd: "scroll";
  tabId: number;
  ref?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
}

export interface SelectOptionServerMessage extends ServerMessageBase {
  cmd: "select-option";
  tabId: number;
  ref?: string;
  selector?: string;
  value: string;
}

export interface RunJsServerMessage extends ServerMessageBase {
  cmd: "run-js";
  tabId: number;
  code: string;
}

export interface ReadConsoleServerMessage extends ServerMessageBase {
  cmd: "read-console";
  tabId: number;
  pattern?: string;
  clear?: boolean;
}

export interface ReadNetworkServerMessage extends ServerMessageBase {
  cmd: "read-network";
  tabId: number;
  urlPattern?: string;
  clear?: boolean;
}

export interface ArquivoParaEnviar {
  nome: string;
  tipo: string;
  tamanho: number;
  base64: string;
}

/*
 * Enviar arquivo do computador. Com ref/selector de um input[type=file], vai
 * direto nele; sem, a extensao "arma" o arquivo e entrega no proximo seletor
 * de arquivo que a pagina abrir (o botao "Escolher imagem" dos apps).
 */
export interface UploadFileServerMessage extends ServerMessageBase {
  cmd: "upload-file";
  tabId: number;
  ref?: string;
  selector?: string;
  arquivos: ArquivoParaEnviar[];
}

export type ServerMessage =
  | OpenTabServerMessage
  | CloseTabsServerMessage
  | GetTabListServerMessage
  | GetBrowserRecentHistoryServerMessage
  | GetTabContentServerMessage
  | ReorderTabsServerMessage
  | FindHighlightServerMessage
  | GroupTabsServerMessage
  | CaptureScreenshotServerMessage
  | NavigateServerMessage
  | SnapshotServerMessage
  | ClickServerMessage
  | TypeServerMessage
  | PressKeyServerMessage
  | ScrollServerMessage
  | SelectOptionServerMessage
  | RunJsServerMessage
  | ReadConsoleServerMessage
  | ReadNetworkServerMessage
  | UploadFileServerMessage;

export type ServerMessageRequest = ServerMessage & { correlationId: string };
