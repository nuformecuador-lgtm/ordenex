import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Feature 426 — GUARDIA (R10): NINGUNA ruta de `app/api/**` se rechaza redirigiendo.
 *
 * POR QUE NO BASTAN LOS CASOS DE R1-R8. Esos fijan dos pathnames concretos
 * (`/api/ordenes/carga-masiva/chunk` y `/api/chat/media/[mensajeId]`), que son los dos que hoy
 * pasan por el guard de sesion. La ruta de API NUMERO 25 no esta escrita todavia, y el modo de
 * fallo de este repo es el MUDO: nadie va a notar que la nueva redirige —el cliente sigue el 307,
 * recibe el HTML del login con 200 y lo da por bueno—. Eso es exactamente lo que paso y lo que
 * reporto el integrador el 2026-09-14.
 *
 * COMO MIDE. Recorre el ARBOL DE ARCHIVOS (los `route.ts` bajo `app/api`), no el grafo de
 * imports: a un `route.ts` no lo importa nadie, asi que ningun selector por imports lo elegiria.
 * De cada archivo deduce su pathname (`[param]` -> un literal) y corre el MIDDLEWARE REAL sin
 * cookie sobre el, exigiendo que el desenlace no sea un 3xx.
 *
 * Se mockea SOLO `isSessionActive` (la frontera con la DB). Sin cookie ni siquiera se llama; el
 * mock esta para no arrastrar Prisma a una guardia que solo lee archivos.
 */

const isSessionActive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-guard", () => ({ isSessionActive }));

const { middleware } = await import("@/middleware");

const RAIZ = path.resolve(__dirname, "../../..");
const DIR_API = path.join(RAIZ, "app", "api");
const BASE_URL = "https://app.test";

/** Todos los `route.ts` bajo `app/api`, en rutas relativas con `/`. */
function archivosDeRuta(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      encontrados.push(...archivosDeRuta(completo));
      continue;
    }
    if (entrada === "route.ts" || entrada === "route.tsx") {
      encontrados.push(path.relative(RAIZ, completo).split(path.sep).join("/"));
    }
  }
  return encontrados.sort();
}

/**
 * Pathname que sirve ese archivo. `app/api/x/[id]/route.ts` -> `/api/x/VALOR`. Los segmentos
 * dinamicos se sustituyen por un literal cualquiera: al middleware solo le importa el prefijo.
 * Los grupos `(...)` no aparecen en la URL.
 */
function pathnameDe(archivo: string): string {
  const segmentos = archivo
    .replace(/^app/, "")
    .replace(/\/route\.tsx?$/, "")
    .split("/")
    .filter((s) => s !== "" && !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => {
      if (s.startsWith("[...") || s.startsWith("[[...")) return "segmento/de/captura";
      if (s.startsWith("[")) return "11111111-2222-4333-8444-555555555555";
      return s;
    });
  return `/${segmentos.join("/")}`;
}

const ARCHIVOS = archivosDeRuta(DIR_API);

function sinCookie(pathname: string, metodo = "GET"): NextRequest {
  return new NextRequest(new URL(pathname, BASE_URL), { method: metodo });
}

beforeEach(() => {
  isSessionActive.mockReset();
  isSessionActive.mockResolvedValue(false);
});

describe("R10 — ninguna ruta de app/api responde 3xx sin cookie de sesion", () => {
  it("CONTROL DE NO-VACUIDAD: el barrido encuentra los archivos de ruta del arbol", () => {
    // Una guardia que no encuentra archivos queda verde POR VACIO, que es justo el fallo que
    // vino a cerrar. 24 archivos medidos el 2026-09-14; el numero solo puede crecer.
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(24);
    expect(ARCHIVOS).toContain("app/api/ordenes/carga-masiva/chunk/route.ts");
    expect(ARCHIVOS).toContain("app/api/chat/media/[mensajeId]/route.ts");
  });

  it("CONTROL DE NO-VACUIDAD: los pathnames se construyen bien (el `[param]` se sustituye)", () => {
    expect(pathnameDe("app/api/chat/media/[mensajeId]/route.ts")).toMatch(
      /^\/api\/chat\/media\/[^[]+$/,
    );
    expect(pathnameDe("app/api/ordenes/carga-masiva/chunk/route.ts")).toBe(
      "/api/ordenes/carga-masiva/chunk",
    );
    expect(ARCHIVOS.map(pathnameDe).every((p) => p.startsWith("/api/"))).toBe(true);
  });

  it("ninguna ruta de API recibe del guard un 3xx ni una cabecera Location", async () => {
    const ofensores: string[] = [];

    for (const archivo of ARCHIVOS) {
      const pathname = pathnameDe(archivo);
      const res = await middleware(sinCookie(pathname));
      const location = res.headers.get("location");
      if ((res.status >= 300 && res.status < 400) || location !== null) {
        ofensores.push(`${archivo} -> ${pathname} devolvio ${res.status} (location=${location})`);
      }
    }

    // El mensaje nombra al archivo de ruta culpable: si alguien añade un `/api/*` nuevo y el
    // guard vuelve a redirigirlo, el rojo dice CUAL, no solo que hay uno.
    expect(ofensores).toEqual([]);
  });

  it("CONTROL: las dos rutas guardadas por sesion responden 401 con JSON (no es que pasen todas)", async () => {
    // Sin este control la guardia seguiria verde si alguien "arreglara" el 3xx metiendo
    // `/api/chat` o `/api/ordenes` en una lista de excepcion —lo que ademas abriria la media
    // del cliente al mundo—. Aqui se exige el rechazo, no solo la ausencia de redirect.
    for (const archivo of [
      "app/api/ordenes/carga-masiva/chunk/route.ts",
      "app/api/chat/media/[mensajeId]/route.ts",
    ]) {
      const res = await middleware(sinCookie(pathnameDe(archivo), "POST"));

      expect(res.status, `${archivo} deberia seguir detras del guard`).toBe(401);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      const cuerpo = (await res.json()) as Record<string, unknown>;
      expect(cuerpo.code).toBe("UNAUTHORIZED");
    }
  });

  it("CONTROL: una ruta con autenticacion propia sigue PASANDO el guard (R8)", async () => {
    // El otro extremo: las 21 self-auth y la publica no se enteran de este cambio. Su 401 (o su
    // 200) lo decide su handler, no el borde.
    for (const archivo of [
      "app/api/cron/procesar-jobs/route.ts",
      "app/api/ordenes/api-key/carga/route.ts",
      "app/api/webhooks/whatsapp/route.ts",
      "app/api/docs/openapi/route.ts",
    ]) {
      const res = await middleware(sinCookie(pathnameDe(archivo)));

      expect(res.status, `${archivo} deberia pasar el guard`).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});
