/* Routeur minimal : méthode + motif avec paramètres (/api/bookmarks/:id) */

export type Handler<C> = (ctx: C, params: Record<string, string>) => Promise<Response> | Response;

interface Route<C> {
  method: string;
  pattern: string;
  parts: string[];
  handler: Handler<C>;
}

export class Router<C> {
  private routes: Route<C>[] = [];

  on(method: string, pattern: string, handler: Handler<C>) {
    this.routes.push({ method, pattern, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler<C>) { return this.on('GET', p, h); }
  post(p: string, h: Handler<C>) { return this.on('POST', p, h); }
  patch(p: string, h: Handler<C>) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler<C>) { return this.on('DELETE', p, h); }

  /** Renvoie le gestionnaire et les paramètres, « method » si le chemin existe pour une autre méthode, ou null */
  match(method: string, pathname: string): { handler: Handler<C>; params: Record<string, string>; route: string } | 'method' | null {
    const segs = pathname.split('/').filter(Boolean);
    let pathExists = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathExists = true;
      if (r.method === method) return { handler: r.handler, params, route: `${r.method} ${r.pattern}` };
    }
    return pathExists ? 'method' : null;
  }
}
