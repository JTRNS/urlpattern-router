import { type RoutePath } from "./route_path.ts";

// deno-lint-ignore no-explicit-any
type Handler<T = any, U = any> = (
  req: Request,
  ctx: T,
  ...args: U[]
) => Response | Promise<Response>;
/**
 * Represents a request handler function that accepts a generic parameter `P` for route parameters
 * and a generic parameter `T` for the context object.
 * The `params` property of the `T` type is used to store the route parameters.
 *
 * @template P - The type of route parameters.
 * @template T - The type of the request body.
 */
export type RequestHandler<P, T> = Handler<T & { params: RoutePath<P> }>;
/**
 * Represents a middleware handler function.
 * @template P - The type of the route parameters. Should be automatically inferred.
 * @template T - The type of the context object. This is the type used when creating a new Router instance
 */
export type MiddlewareHandler<T> = Handler<
  T & { next(): Response | Promise<Response> }
>;

interface StaticRoute {
  method: string;
  pathname: string;
  handler: Handler;
  middleware?: Handler;
}

interface DynamicRoute extends StaticRoute {
  pattern: URLPattern;
  params: Record<string, string>;
}

type Route = StaticRoute | DynamicRoute;

/**
 * Represents a router that handles routing and middleware for HTTP requests.
 *
 * @template T - The type of the context object.
 * @template Env - The type of the environment object.
 */
export class Router<
  T extends object = Record<string | number | symbol, never>,
  // deno-lint-ignore no-explicit-any
  Env extends any = any,
> {
  #cachedRoutes: Record<string, Record<string, Route | undefined> | undefined> =
    {};
  #dynamicRoutes: Record<string, DynamicRoute[]> = {};
  #staticRoutes: Record<string, Record<StaticRoute["pathname"], StaticRoute>> =
    {};

  #middlewares: [URLPattern, MiddlewareHandler<T>[]][] = [];

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
        handler: handler,
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
        handler: handler,
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

  use(path: string, handler: MiddlewareHandler<T>) {
    for (let i = 0; i < this.#middlewares.length; i++) {
      const [pattern, handlers] = this.#middlewares[i];
      if (pattern.pathname === path) {
        handlers.push(handler as MiddlewareHandler<T>);
        return;
      }
    }
    this.#middlewares.push([new URLPattern({ pathname: path }), [
      handler,
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
    const handler = route.handler;
    const composedMiddleware = route.middleware;
    const params = "params" in route ? route.params : {};
    const next = async (
      response: Response = new Response(),
    ): Promise<Response> => {
      if (composedMiddleware) {
        response = await composedMiddleware(
          request,
          Object.assign(context, { next }, params),
          ...args,
        );
      }
      response = await handler(
        request,
        Object.assign(context, { params }),
        ...args,
      );

      return response;
    };
    return next();
  }

  composeMiddleware(
    middlewares: MiddlewareHandler<T>[],
  ): Handler<T, Env> {
    return (request, context, ...args) => {
      let index = -1;
      return next(0);
      function next(i: number): Promise<Response> {
        if (i <= index) {
          return Promise.reject(new Error("next() called multiple times"));
        }
        index = i;
        const fn = middlewares.at(i);

        if (!fn) return Promise.resolve(new Response());
        try {
          return Promise.resolve(
            fn(
              request,
              Object.assign(context, { next: next.bind(null, i + 1) }),
              ...args,
            ),
          );
        } catch (err) {
          return Promise.reject(err);
        }
      }
    };
  }

  match(method: string, path: string): Handler<T, Env> {
    const cached = this.#cachedRoutes?.[method]?.[path];
    if (cached) {
      console.count("CACHE HIT");
      return (req: Request, ctx: T, ...args: Env[]) =>
        this.#handleRoute(req, cached, ctx, ...args);
    }

    const collection: MiddlewareHandler<T>[] = [];
    for (let i = 0; i < this.#middlewares.length; i++) {
      const [pattern, handlers] = this.#middlewares[i];
      if (pattern.test({ pathname: path })) {
        for (let j = 0; j < handlers.length; j++) {
          const middlewareHandler = handlers[j];
          collection.push(middlewareHandler);
        }
      }
    }

    const middlewareHandler = this.composeMiddleware(collection);

    const staticRoute: StaticRoute | undefined = this.#staticRoutes?.[method]
      ?.[path];
    if (staticRoute) {
      staticRoute.middleware = middlewareHandler;
      this.#cachedRoutes[method] = { [path]: staticRoute };
      return (req: Request, ctx: T, ...args) =>
        this.#handleRoute(req, staticRoute, ctx, ...args);
    }

    // if it is not a cached or static route, find a matching dynamic route.
    const possibleDynamicRoutes = this.#dynamicRoutes[method];
    if (possibleDynamicRoutes) {
      for (let i = possibleDynamicRoutes.length; i--;) {
        const dynamicRoute = possibleDynamicRoutes[i];
        const params = dynamicRoute.pattern.exec({ pathname: path });
        if (params !== null) {
          dynamicRoute.middleware = middlewareHandler;
          dynamicRoute.params = params.pathname.groups as Record<
            string,
            string
          >;
          this.#cachedRoutes[method] = { [path]: dynamicRoute };
          return (req: Request, ctx: T, ...args) =>
            this.#handleRoute(req, dynamicRoute, ctx, ...args);
        }
      }
    }

    const notFoundRoute: StaticRoute = {
      method,
      pathname: path,
      handler: () => new Response("Not Found", { status: 404 }),
      middleware: middlewareHandler,
    };

    this.#cachedRoutes[method] = { [path]: notFoundRoute };

    return (req: Request, ctx: T, ...args) =>
      this.#handleRoute(req, notFoundRoute, ctx, ...args);
  }

  handle(req: Request, ctx: T, ...args: Env[]): ReturnType<Handler<T, Env>> {
    const method = req.method;
    const match = req.url.match(/^https?:\/\/[^/]+(\/[^?]*)/);
    const pathname = match ? match[1] : "";
    return this.match(method, pathname)(req, ctx, ...args);
  }

  fetch: typeof this.handle = this.handle.bind(this);
}
