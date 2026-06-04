// per-platform connection config (what to watch). twitch channel defaults to the login name.
export function normalizeConnections(raw: any, name: string, slToken: string){
    const c = raw || {};
    const t = c.twitch || {};
    const s = c.streamlabs || {};
    return {
        twitch: { channel: typeof t.channel === "string" && t.channel ? t.channel : (name || "") },
        streamlabs: { token: typeof s.token === "string" ? s.token : (slToken || "") },
    };
}
