import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { google } from "googleapis";
import express from "express";
import { z } from "zod";

const serviceAccountB64 = process.env.GSC_SERVICE_ACCOUNT_JSON;
if (!serviceAccountB64) throw new Error("GSC_SERVICE_ACCOUNT_JSON env var required");

const credentials = JSON.parse(Buffer.from(serviceAccountB64, 'base64').toString('utf8'));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});

const gsc = google.searchconsole({ version: "v1", auth });

function buildServer() {
  const server = new McpServer({ name: "synertech-gsc", version: "1.0.0" });

  server.tool(
    "list_sites",
    "List all GSC properties accessible to this service account",
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
      dimensions: z.array(z.enum(["query", "page", "country", "device"])).optional().describe("Group by, default: query"),
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
    { siteUrl: z.string().describe("Site URL") },
    async ({ siteUrl }) => {
      const res = await gsc.sitemaps.list({ siteUrl });
      return {
        content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.all("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.json({ status: "ok", name: "synertech-gsc-mcp" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Synertech GSC MCP running on port ${PORT}`));
