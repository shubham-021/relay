"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function RemotePlayListener() {
    useEffect(() => {
        const es = new EventSource("/api/remote-control");

        es.onmessage = async (event) => {
            try {
                const payload = JSON.parse(event.data);
                toast.info(`Request received for playback in ${payload.player.toUpperCase()}`);

                // Directly post to Aemond on your local machine
                const res = await fetch("http://localhost:9070/play", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                if (res.ok) {
                    toast.success("Player launched successfully!");
                }
            } catch (err) {
                console.error("Remote play error:", err);
            }
        };

        return () => es.close();
    }, []);

    return null;
}