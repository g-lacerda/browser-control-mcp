import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserAPI } from "./browser-api";
import { lerArquivo } from "./arquivos";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const mcpServer = new McpServer({
  name: "ClaudeNoFirefox",
  version: "1.5.2",
});

mcpServer.tool(
  "open-browser-tab",
  "Open a new tab in Firefox, inside the \"Claude\" tab group. Returns the tab id. Only tabs opened this way can be read or acted on; the user's own tabs are off limits. http and https URLs (including http://localhost) are allowed.",
  {
    url: z.string(),
    width: z.number().int().min(320).max(2560).optional().describe("Open in a separate window this wide (CSS px), e.g. 390 to test a phone layout"),
    height: z.number().int().min(480).max(1600).optional().describe("Window height when width is given, e.g. 844"),
  },
  async ({ url, width, height }) => {
    const openedTabId = await browserApi.openTab(url, width, height);
    if (openedTabId !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: `${url} opened in tab id ${openedTabId}`,
          },
        ],
      };
    } else {
      return {
        content: [{ type: "text", text: "Failed to open tab", isError: true }],
      };
    }
  }
);

mcpServer.tool(
  "close-browser-tabs",
  "Close tabs in the user's browser by tab IDs",
  { tabIds: z.array(z.number()) },
  async ({ tabIds }) => {
    await browserApi.closeTabs(tabIds);
    return {
      content: [{ type: "text", text: "Closed tabs" }],
    };
  }
);

mcpServer.tool(
  "get-list-of-open-tabs",
  "List the tabs in the \"Claude\" tab group (the user's own tabs are never listed). Use offset and limit for pagination.",
  {
    offset: z.number().int().min(0).default(0).describe("Starting index for pagination (0-based, must be >= 0)"),
    limit: z.number().default(100).describe("Maximum number of tabs to return (default: 100, max: 500)"),
  },
  async ({ offset, limit }) => {
    // Validate and cap the limit
    const effectiveLimit = Math.min(Math.max(1, limit), 500);

    const openTabs = await browserApi.getTabList();
    const totalTabs = openTabs.length;

    // Apply pagination
    const paginatedTabs = openTabs.slice(offset, offset + effectiveLimit);
    const hasMore = offset + effectiveLimit < totalTabs;

    // Add pagination info as the first content item
    const paginationInfo = {
      type: "text" as const,
      text: `Showing tabs ${offset + 1}-${offset + paginatedTabs.length} of ${totalTabs} total tabs${hasMore ? ` (use offset=${offset + effectiveLimit} to see more)` : ''}`,
    };

    const tabContent = paginatedTabs.map((tab) => {
      let lastAccessed = "unknown";
      if (tab.lastAccessed) {
        lastAccessed = dayjs(tab.lastAccessed).fromNow(); // LLM-friendly time ago
      }
      return {
        type: "text" as const,
        text: `tab id=${tab.id}, tab url=${tab.url}, tab title=${tab.title}, last accessed=${lastAccessed}`,
      };
    });

    return {
      content: [paginationInfo, ...tabContent],
    };
  }
);

mcpServer.tool(
  "get-recent-browser-history",
  "Get the list of recent browser history (to get all, don't use searchQuery)",
  { searchQuery: z.string().optional() },
  async ({ searchQuery }) => {
    const browserHistory = await browserApi.getBrowserRecentHistory(
      searchQuery
    );
    if (browserHistory.length > 0) {
      return {
        content: browserHistory.map((item) => {
          let lastVisited = "unknown";
          if (item.lastVisitTime) {
            lastVisited = dayjs(item.lastVisitTime).fromNow(); // LLM-friendly time ago
          }
          return {
            type: "text",
            text: `url=${item.url}, title="${item.title}", lastVisitTime=${lastVisited}`,
          };
        }),
      };
    } else {
      // If nothing was found for the search query, hint the AI to list
      // all the recent history items instead.
      const hint = searchQuery ? "Try without a searchQuery" : "";
      return { content: [{ type: "text", text: `No history found. ${hint}` }] };
    }
  }
);

mcpServer.tool(
  "get-tab-web-content",
  `
    Get the full text content of the webpage and the list of links in the webpage, by tab ID. 
    Use "offset" only for larger documents when the first call was truncated and if you require more content in order to assist the user.
  `,
  { tabId: z.number(), offset: z.number().default(0) },
  async ({ tabId, offset }) => {
    const content = await browserApi.getTabContent(tabId, offset);
    let links: { type: "text"; text: string }[] = [];
    if (offset === 0) {
      // Only include the links if offset is 0 (default value). Otherwise, we can
      // assume this is not the first call. Adding the links again would be redundant.
      links = content.links.map((link: { text: string; url: string }) => {
        return {
          type: "text",

          text: `Link text: ${link.text}, Link URL: ${link.url}`,
        };
      });
    }

    let text = content.fullText;
    let hint: { type: "text"; text: string }[] = [];
    if (content.isTruncated || offset > 0) {
      // If the content is truncated, add a "tip" suggesting
      // that another tool, search in page, can be used to
      // discover additional data.
      const rangeString = `${offset}-${offset + text.length}`;
      hint = [
        {
          type: "text",
          text:
            `The following text content is truncated due to size (includes character range ${rangeString} out of ${content.totalLength}). ` +
            "If you want to read characters beyond this range, please use the 'get-tab-web-content' tool with an offset. ",
        },
      ];
    }

    return {
      content: [...hint, { type: "text", text }, ...links],
    };
  }
);

mcpServer.tool(
  "reorder-browser-tabs",
  "Change the order of open browser tabs",
  { tabOrder: z.array(z.number()) },
  async ({ tabOrder }) => {
    const newOrder = await browserApi.reorderTabs(tabOrder);
    return {
      content: [
        { type: "text", text: `Tabs reordered: ${newOrder.join(", ")}` },
      ],
    };
  }
);

mcpServer.tool(
  "find-highlight-in-browser-tab",
  "Find and highlight text in a browser tab (use a query phrase that exists in the web content)",
  { tabId: z.number(), queryPhrase: z.string() },
  async ({ tabId, queryPhrase }) => {
    const noOfResults = await browserApi.findHighlight(tabId, queryPhrase);
    return {
      content: [
        {
          type: "text",
          text: `Number of results found and highlighted in the tab: ${noOfResults}`,
        },
      ],
    };
  }
);

mcpServer.tool(
  "group-browser-tabs",
  "Organize opened browser tabs in a new tab group",
  {
    tabIds: z.array(z.number()),
    isCollapsed: z.boolean().default(false),
    groupColor: z
      .enum([
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange",
      ])
      .default("grey"),
    groupTitle: z.string().default("New Group"),
  },
  async ({ tabIds, isCollapsed, groupColor, groupTitle }) => {
    const groupId = await browserApi.groupTabs(
      tabIds,
      isCollapsed,
      groupColor,
      groupTitle
    );
    return {
      content: [
        {
          type: "text",
          text: `Created tab group "${groupTitle}" with ${tabIds.length} tabs (group ID: ${groupId})`,
        },
      ],
    };
  }
);

mcpServer.tool(
  "capture-tab-screenshot",
  `
    Capture a screenshot of the visible area of one of Claude's tabs, by tab ID.
    Capturing brings the tab to the foreground momentarily. Only the page inside the tab is captured,
    never the rest of the screen.
  `,
  {
    tabId: z.number(),
    format: z
      .enum(["jpeg", "png"])
      .default("jpeg")
      .describe("Use png only when exact pixel fidelity matters, as it is much larger"),
    quality: z.number().int().min(10).max(100).default(70).describe("JPEG quality, ignored for png"),
    scale: z
      .number()
      .min(0.1)
      .max(2)
      .default(1)
      .describe("Image scale relative to CSS pixels, lower values produce smaller images"),
  },
  async ({ tabId, format, quality, scale }) => {
    const screenshot = await browserApi.captureScreenshot(tabId, format, quality, scale);
    return {
      content: [{ type: "image", data: screenshot.imageData, mimeType: screenshot.mimeType }],
    };
  }
);

/* ── agir na pagina (so nas abas do grupo "Claude") ── */

const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const resultadoDaAcao = (r: { result: string; url?: string; title?: string }) =>
  texto(`${r.result}\nPagina: ${r.title ?? ""} (${r.url ?? ""})`);

const alvo = {
  ref: z.string().optional().describe("Element reference from read-page-elements, like e12 (preferred)"),
  selector: z.string().optional().describe("CSS selector, when there is no ref"),
};

mcpServer.tool(
  "navigate-tab",
  "Navigate one of Claude's tabs to a URL, or go back/forward/reload. Waits for the page to load.",
  { tabId: z.number(), url: z.string().describe('URL, or "back", "forward", "reload"') },
  async ({ tabId, url }) => resultadoDaAcao(await browserApi.comando({ cmd: "navigate", tabId, url }, "action-result"))
);

mcpServer.tool(
  "read-page-elements",
  `
    Read the page of one of Claude's tabs as a list of elements with references (e1, e2...), their role,
    name and state. Use the refs with click/type/select. Refs are renewed on every read, so read again
    after the page changes. interactiveOnly=false also includes headings and text blocks.
  `,
  { tabId: z.number(), interactiveOnly: z.boolean().default(true) },
  async ({ tabId, interactiveOnly }) => {
    const r = await browserApi.comando({ cmd: "snapshot", tabId, interactiveOnly }, "snapshot");
    return texto(`Pagina: ${r.title} (${r.url})\n${r.text || "(nenhum elemento visivel)"}`);
  }
);

mcpServer.tool(
  "click-element",
  "Click an element in one of Claude's tabs, by ref (from read-page-elements), CSS selector, or x/y viewport coordinates.",
  { tabId: z.number(), ...alvo, x: z.number().optional(), y: z.number().optional(), double: z.boolean().default(false) },
  async ({ tabId, ref, selector, x, y, double }) =>
    resultadoDaAcao(await browserApi.comando({ cmd: "click", tabId, ref, selector, x, y, double }, "action-result"))
);

mcpServer.tool(
  "type-text",
  `
    Type text into an input, textarea or editable element in one of Claude's tabs. clear=true replaces the
    current value. submit=true presses Enter afterwards. Real credit card numbers are refused by the
    extension: only sandbox/test cards are accepted.
  `,
  { tabId: z.number(), ...alvo, text: z.string(), clear: z.boolean().default(true), submit: z.boolean().default(false) },
  async ({ tabId, ref, selector, text, clear, submit }) =>
    resultadoDaAcao(await browserApi.comando({ cmd: "type", tabId, ref, selector, text, clear, submit }, "action-result"))
);

mcpServer.tool(
  "press-key",
  "Press a key on the focused element of one of Claude's tabs (Enter, Tab, Escape, ArrowDown...).",
  { tabId: z.number(), key: z.string() },
  async ({ tabId, key }) => resultadoDaAcao(await browserApi.comando({ cmd: "press-key", tabId, key }, "action-result"))
);

mcpServer.tool(
  "scroll-page",
  "Scroll one of Claude's tabs: to an element (ref) or in a direction.",
  {
    tabId: z.number(),
    ref: z.string().optional(),
    direction: z.enum(["up", "down", "left", "right"]).default("down"),
    amount: z.number().int().min(1).max(30).default(3),
  },
  async ({ tabId, ref, direction, amount }) =>
    resultadoDaAcao(await browserApi.comando({ cmd: "scroll", tabId, ref, direction, amount }, "action-result"))
);

mcpServer.tool(
  "select-option",
  "Choose an option in a <select> in one of Claude's tabs, by option value or visible text.",
  { tabId: z.number(), ...alvo, value: z.string() },
  async ({ tabId, ref, selector, value }) =>
    resultadoDaAcao(await browserApi.comando({ cmd: "select-option", tabId, ref, selector, value }, "action-result"))
);

mcpServer.tool(
  "run-javascript",
  "Run JavaScript in one of Claude's tabs (DOM access). Use return for multi-statement code; the result comes back as JSON.",
  { tabId: z.number(), code: z.string() },
  async ({ tabId, code }) => {
    const r = await browserApi.comando({ cmd: "run-js", tabId, code }, "js-result");
    return texto(r.value);
  }
);

mcpServer.tool(
  "read-console",
  "Read console messages of one of Claude's tabs. Capture starts on the first call, so call once before reproducing the issue. pattern is a regex filter.",
  { tabId: z.number(), pattern: z.string().optional(), clear: z.boolean().default(false) },
  async ({ tabId, pattern, clear }) => {
    const r = await browserApi.comando({ cmd: "read-console", tabId, pattern, clear }, "console");
    if (r.entries.length === 0) return texto("Nenhuma mensagem no console desde que a captura comecou.");
    return texto(r.entries.map((e) => `[${e.level}] ${e.text}`).join("\n"));
  }
);

mcpServer.tool(
  "read-network-requests",
  "Read the network requests made by one of Claude's tabs since it was opened (most recent last). urlPattern filters by substring.",
  { tabId: z.number(), urlPattern: z.string().optional(), clear: z.boolean().default(false) },
  async ({ tabId, urlPattern, clear }) => {
    const r = await browserApi.comando({ cmd: "read-network", tabId, urlPattern, clear }, "network");
    if (r.requests.length === 0) return texto("Nenhuma requisicao registrada.");
    return texto(r.requests.map((q) => `${q.method} ${q.status} ${q.type} ${q.url}`).join("\n"));
  }
);

mcpServer.tool(
  "upload-file",
  `
    Send files from this computer into a file upload in one of Claude's tabs. Give full paths.
    With ref/selector of an <input type=file>, the files go straight into it. Without them, the extension
    holds the files and delivers them to the next file picker the page opens: call this first, then click
    the page's "choose file" button. Hidden files, keys/secrets and files over 25 MB are always refused;
    the user may also have to approve each file in Firefox, depending on the extension settings.
  `,
  {
    tabId: z.number(),
    paths: z.array(z.string()).min(1).max(10).describe("Full paths of the files, e.g. /home/user/Pictures/photo.jpg"),
    ref: z.string().optional().describe("Ref of an <input type=file>, when the page has one"),
    selector: z.string().optional(),
  },
  async ({ tabId, paths, ref, selector }) => {
    const arquivos = await Promise.all(paths.map((p) => lerArquivo(p)));
    const r = await browserApi.comando({ cmd: "upload-file", tabId, ref, selector, arquivos }, "action-result", 150000);
    return resultadoDaAcao(r);
  }
);

const browserApi = new BrowserAPI();
browserApi.init().catch((err) => {
  console.error("Browser API init error", err);
  process.exit(1);
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((err) => {
  console.error("MCP Server connection error", err);
  process.exit(1);
});

process.stdin.on("close", () => {
  browserApi.close();
  mcpServer.close();
  process.exit(0);
});
