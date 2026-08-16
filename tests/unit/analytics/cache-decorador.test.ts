import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { TAG_OPERATIVA } from "@/lib/analytics/cache-tags";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import type { EtiquetaEstatus } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import { cacheFalsa } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO, rollupFalso } from "./_fake-operativa";

// Feature 128 / T3.1 — R2, R4 y R22. EL DECORADOR.
//
// R2 es el requisito del que cuelgan TODOS los de invalidacion: no se puede demostrar que algo
// se invalida si nunca se cachea. Por eso su asercion es un contador de llamadas al
// repositorio INTERNO, no un espia de la cache.

const SIN_GRANO: readonly DimensionAnalitica[] = [];
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

describe("R2 · una segunda consulta equivalente no vuelve a llamar al repositorio interno", () => {
  it("la segunda consulta se sirve de cache", async () => {
    const interno = rollupFalso([cubo({ fecha: "2026-08-01", entregas: 5 })]);
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());
    const consulta = consultaDe("entregas", MAESTRO, { rango: "dia" });

    const primera = await repo.agregarCubos(consulta, SIN_GRANO);
    const segunda = await repo.agregarCubos(consulta, SIN_GRANO);

    expect(interno.llamadasAgregar).toHaveLength(1);
    expect(segunda).toEqual(primera);
  });

  it("y la entrada se escribe con el tag del dominio operativa", async () => {
    const cache = cacheFalsa();
    const repo = new CachedAnaliticaOperativaRollupRepository(
      rollupFalso([cubo({ fecha: "2026-08-01" })]),
      cache,
    );
    await repo.agregarCubos(consultaDe("entregas", MAESTRO, { rango: "dia" }), SIN_GRANO);

    expect(cache.tamano()).toBe(1);
    // Invalidar ese tag la borra: es la comprobacion de que se escribio CON el, y no una
    // asercion sobre la cadena.
    await cache.invalidar("manual", [TAG_OPERATIVA]);
    expect(cache.tamano()).toBe(0);
  });

  it("el HIT devuelve `segCicloAcum` como `bigint`, no como el `string` del JSON", async () => {
    const interno = rollupFalso([cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(90), segCicloN: 3 })]);
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());
    const consulta = consultaDe("entregas", MAESTRO, { rango: "dia" });

    await repo.agregarCubos(consulta, SIN_GRANO);
    const desdeCache = await repo.agregarCubos(consulta, SIN_GRANO);

    expect(typeof desdeCache[0].segCicloAcum).toBe("bigint");
    expect(desdeCache[0].segCicloAcum).toBe(BigInt(90));
  });
});

describe("R4 · `etiquetasDeEstatus` se delega siempre y su Map llega intacto", () => {
  it("dos llamadas van las dos al repositorio interno y el `Map` conserva sus entradas", async () => {
    let llamadas = 0;
    const etiquetas = new Map<string, EtiquetaEstatus>([
      ["e-1", { value: "entregada", label: "entregada" }],
    ]);
    const interno = {
      async agregarCubos() {
        return [];
      },
      async etiquetasDeEstatus(): Promise<ReadonlyMap<string, EtiquetaEstatus>> {
        llamadas += 1;
        return etiquetas;
      },
    };
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());

    const primera = await repo.etiquetasDeEstatus(["e-1"]);
    const segunda = await repo.etiquetasDeEstatus(["e-1"]);

    // Si se envolviera con la cache, el `Map` volveria como `{}` y la dimension se etiquetaria
    // con ids crudos en vez de con el `value` del estatus.
    expect(llamadas).toBe(2);
    expect(primera).toBeInstanceOf(Map);
    expect(segunda.get("e-1")).toEqual({ value: "entregada", label: "entregada" });
    expect(segunda.size).toBe(1);
  });
});

describe("R22 · el decorador no conoce Prisma", () => {
  it("no importa `@prisma/client` ni nombra la tabla del rollup", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "repositories", "CachedAnaliticaOperativaRollupRepository.ts"),
      "utf8",
    );
    const codigo = quitarComentarios(fuente);
    expect(codigo).not.toMatch(/@prisma\/client/);
    expect(codigo).not.toMatch(/analyticsDaily|analytics_daily/);
    expect(codigo).not.toMatch(/groupBy/);
    // El unico lector de `analytics_daily` sigue siendo el repositorio de la 126 (R42 de la
    // 124): el decorador DELEGA.
    expect(codigo).toMatch(/this\.interno\.agregarCubos\(/);
  });
});
