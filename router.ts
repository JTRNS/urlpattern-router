import { type RoutePath } from "./route_path.ts";

// deno-lint-ignore no-explicit-any
type Handler<T = any, U = any> = (
  req: Request,
  ctx: T,
  ...args: U[]
) => Response | Promise<Response>;
type RequestHandler<P, T> = Handler<T & { params: RoutePath<P> }>;
type MiddlewareHandler<P, T> = Handler<
  T & { params: RoutePath<P>; next(): Response | Promise<Response> }
>;

interface StaticRoute {
  method: string;
  pathname: string;
  handlers: Handler[];
}

interface DynamicRoute extends StaticRoute {
  pattern: URLPattern;
  params: Record<string, string>;
}

type Route = StaticRoute | DynamicRoute;

// deno-lint-ignore no-explicit-any
export class Router<
  T extends object = Record<string | number | symbol, never>,
  Env extends any = any,
> {
  #cachedRoutes: Record<string, Record<string, Route | undefined> | undefined> =
    {};
  #dynamicRoutes: Record<string, DynamicRoute[]> = {};
  #staticRoutes: Record<string, Record<StaticRoute["pathname"], StaticRoute>> =
    {};

  #middlewares: Array<[URLPattern, MiddlewareHandler<string, T>[]]> = [];

  add<P extends string>(
    method: string | string[],
    path: P,
    handler: RequestHandler<P, T>,
  ): void {
    if (Array.isArray(method)) {
      return method.forEach((m) => this.add(m, path, handler));
    }
    const isDynamic = /\*|\/:/.test(path);
    if (!isDynamic) {
      const r: StaticRoute = {
        method,
        pathname: path,
        handlers: [handler],
      };
      if (this.#staticRoutes[method]) {
        this.#staticRoutes[method][path] = r;
      } else {
        this.#staticRoutes[method] = { [path]: r };
      }
    } else {
      const r: DynamicRoute = {
        method,
        pathname: path,
        handlers: [handler],
        pattern: new URLPattern({ pathname: path }),
        params: {},
      };
      if (this.#dynamicRoutes[method]) {
        this.#dynamicRoutes[method].push(r);
      } else {
        this.#dynamicRoutes[method] = [r];
      }
    }
  }

  use<P extends string>(path: P, handler: MiddlewareHandler<P, T>) {
    for (let i = 0; i < this.#middlewares.length; i++) {
      const [pattern, handlers] = this.#middlewares[i];
      if (pattern.pathname === path) {
        handlers.push(handler as MiddlewareHandler<string, T>);
        return;
      }
    }
    this.#middlewares.push([new URLPattern({ pathname: path }), [
      handler as MiddlewareHandler<string, T>,
    ]]);
  }

  get<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("GET", path, handler);
    this.add("HEAD", path, handler);
  }

  post<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("POST", path, handler);
  }

  put<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("PUT", path, handler);
  }

  delete<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("DELETE", path, handler);
  }

  patch<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("PATCH", path, handler);
  }

  options<P extends string>(path: P, handler: RequestHandler<P, T>) {
    this.add("OPTIONS", path, handler);
  }

  // TODO: Fix context object property assignments?
  #handleRoute(
    request: Request,
    route: Route,
    context: T,
    ...args: Env[]
  ): Promise<Response> {
    const handlers = route.handlers;
    let index = handlers.length;
    const params = "params" in route ? route.params : {};
    const next = async (
      response: Response = new Response(),
    ): Promise<Response> => {
      index--;

      if (index > 0) {
        response = await handlers[index](
          request,
          Object.assign(context, { next }, params),
          ...args,
        );
      } else {
        // remove next method from context?
        response = await handlers[index](
          request,
          Object.assign(context, { params }),
          ...args,
        );
      }
      return response;
    };
    return next();
  }

  #attachMiddleware(
    route: Route,
    middlewares: MiddlewareHandler<string, T>[][],
  ) {
    for (let i = 0; i < middlewares.length; i++) {
      for (let j = 0; j < middlewares[i].length; j++) {
        console.log("pushing middleware into handlers of: ", route.pathname);
        route.handlers.push(middlewares[i][j]);
      }
    }
  }

  match(method: string, path: string): Handler<T, Env> {
    const cached = this.#cachedRoutes?.[method]?.[path];
    if (cached) {
      return (req: Request, ctx: T, ...args: Env[]) =>
        this.#handleRoute(req, cached, ctx, ...args);
    }

    const collection: MiddlewareHandler<string, T>[][] = [];
    for (let i = this.#middlewares.length; i--;) {
      const [pattern, handlers] = this.#middlewares[i];
      if (pattern.test({ pathname: path })) {
        collection.push(handlers);
      }
    }

    const staticRoute: StaticRoute | undefined = this.#staticRoutes?.[method]
      ?.[path];
    if (staticRoute) {
      console.count("static route");
      this.#attachMiddleware(staticRoute, collection);
      this.#cachedRoutes[method] = { [path]: staticRoute };
      return (req: Request, ctx: T, ...args) =>
        this.#handleRoute(req, staticRoute, ctx, ...args);
    }

    const routes = this.#dynamicRoutes[method];
    if (!routes) {
      // TODO: Add configurable Method Not Allowed Handler
      return () => new Response("Method Not Allowed", { status: 405 });
    }
    for (let i = routes.length; i--;) {
      const r = routes[i];
      console.log(r);
      const params = r.pattern.exec({ pathname: path });
      if (params !== null) {
        this.#attachMiddleware(r, collection);
        // r.handlers = [this.compose(...r.handlers.concat(collection.flat()))]
        r.params = params.pathname.groups as Record<string, string>;
        this.#cachedRoutes[method] = { [path]: r };
        return (req: Request, ctx: T, ...args) =>
          this.#handleRoute(req, r, ctx, ...args);
      }
    }
    // TODO: Add configurable Not Found Handler
    return () => new Response("Not Found", { status: 404 });
  }

  handle(req: Request, ctx: T, ...args: Env[]) {
    const method = req.method;
    const match = req.url.match(/^https?:\/\/[^/]+(\/[^?]*)/);
    const pathname = match ? match[1] : "";
    return this.match(method, pathname)(req, ctx, ...args);
  }

  fetch = this.handle.bind(this);
}
