type RemoteClient = (data: any) => void;
const activeClients = new Map<number, Set<RemoteClient>>();

export function registerClient(userId: number, send: RemoteClient) {
    if (!activeClients.has(userId)) activeClients.set(userId, new Set());
    activeClients.get(userId)!.add(send);

    return () => {
        const clients = activeClients.get(userId);
        if (!clients) return;

        clients.delete(send);
        if (clients.size === 0) {
            activeClients.delete(userId);
        }
    };
}

export function sendPlayCommand(userId: number, payload: any): boolean {
    const clients = activeClients.get(userId);
    if (!clients || clients.size === 0) return false;

    const latestClient = Array.from(clients).at(-1);
    if (latestClient) {
        latestClient(payload);
        return true;
    }

    return true;
}