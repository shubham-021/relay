import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { createMcpServer } from "./server";
import { getUserById } from "@/lib/db";

const userId = Number(process.env.RELAY_USER_ID ?? "1");

const user = getUserById(userId);
if (!user) {
    console.error(`No user found with ID ${userId}. Set RELAY_USER_ID to a valid user`);
    process.exit(1);
}

const server = createMcpServer({ userId });
const transport = new StdioServerTransport();

await server.connect(transport);

// todo: add later
// client config: 
// {
//   "mcpServers": {
//     "relay": {
//       "command": "bun",
//       "args": ["mcp/stdio.ts"],
//       "cwd": "/path/to/relay"
//     }
//   }
// }