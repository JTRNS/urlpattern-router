# URLPattern Router

An HTTP Request router built on top of the URLPattern API.

## Demo

```ts
import { Router } from "./router.ts";

const router = new Router<Deno.ServeHandlerInfo>();

router.get("/", (_req, ctx) => {
  return new Response(`ip: ${ctx.remoteAddr.hostname}:${ctx.remoteAddr.port}`);
});

router.get("/contacts/:name", (_req, ctx) => {
  return new Response(`Contact: ${ctx.params.name}`);
});

Deno.serve(router.fetch);
```

## Goals

Closely match the definition for a [Request Handler set out by Steven Krouse](https://blog.val.town/blog/the-api-we-forgot-to-name/).

> a function that takes a Request as it’s first argument, can have arbitrary other arguments, and outputs a Response.
