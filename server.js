import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { google } from "googleapis";
import express from "express";
import { z } from "zod";

const serviceAccountJson = process.env.GSC_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) throw new Error("GSC_SERVICE_ACCOUNT_JSON env var required");

const credentials = JSON.parse(serviceAccountJson.replace(/\n/g, '\\n'));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});

const gsc = google.searchconsole({ version: "v1", auth });

const server = new McpServer({ name: "synertech-gsc", version: "1.0.0" });

server.tool(
  "list_sites",
  "List all GSC properties this service account has access to",
  {},
  async () => {
    const res = await gsc.sites.list();
    const sites = res.data.siteEntry || [];
    return {
      content: [{ type: "text", text: sites.map(s => `${s.siteUrl} (${s.permissionLevel})`).join("\n") || "No sites found" }],
    };
  }
);

server.tool(
  "search_analytics",
  "Query GSC search analytics — clicks, impressions, CTR, position",
  {
    siteUrl: z.string().describe("Site URL e.g. https://serdenco.com/"),
    startDate: z.string().describe("Start date YYYY-MM-DD"),
    endDate: z.string().describe("End date YYYY-MM-DD"),
    dimensions: z.array(z.enum(["query", "page", "country", "device"])).optional().describe("Group by dimensions, default: query"),
    rowLimit: z.number().optional().describe("Max rows, default 25"),
  },
  async ({ siteUrl, startDate, endDate, dimensions, rowLimit }) => {
    const res = await gsc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: dimensions || ["query"],
        rowLimit: rowLimit || 25,
      },
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
    };
  }
);

server.tool(
  "list_sitemaps",
  "List sitemaps for a GSC property",
  {
    siteUrl: z.string().describe("Site URL"),
  },
  async ({ siteUrl }) => {
    const res = await gsc.sitemaps.list({ siteUrl });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
    };
  }
);

const app = express();
app.use(express.json());

const transports = {};

app.get("/sse", async (req, res) => {
    res.setHeader("X-Accel-Buffering", "no");
    const transport = new SSEServerTransport("/messages", res);
  
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

app.get("/", (req, res) => res.json({ status: "ok", name: "synertech-gsc-mcp" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Synertech GSC MCP running on port ${PORT}`));
