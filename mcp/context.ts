export interface McpContext {
    // authenticated relay user ID
    userId: number;
    // optional: restrict to a specific torbox acc
    accountId?: number;
}