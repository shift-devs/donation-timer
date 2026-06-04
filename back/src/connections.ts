// per-platform connection config (what to watch). twitch channel defaults to the login name.
export function normalizeConnections(raw: any, name: string, slToken: string){
    const c = raw || {};
    const t = c.twitch || {};
    const s = c.streamlabs || {};
    const f = c.fourthwall || {};
    return {
        twitch: { channel: typeof t.channel === "string" && t.channel ? t.channel : (name || "") },
        streamlabs: { token: typeof s.token === "string" ? s.token : (slToken || "") },
        // fourthwall is polled (outbound, works on localhost). we store the api credentials to keep polling.
        fourthwall: {
            username: typeof f.username === "string" ? f.username : "",
            password: typeof f.password === "string" ? f.password : "",
        },
    };
}
