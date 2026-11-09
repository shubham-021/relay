import { getSession } from "@/lib/session";
import { registerClient } from "@/lib/remote-control";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await getSession();
    if (!session.userId) return new Response("Unauthorized", { status: 401 });

    const userId = session.userId;

    let cleanup: () => void;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            cleanup = registerClient(userId, (data) => {
                controller.enqueue(encoder.encode(`data:${JSON.stringify(data)}\n\n`));
            });
        },
        cancel() {
            cleanup?.();
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
        }
    })
}