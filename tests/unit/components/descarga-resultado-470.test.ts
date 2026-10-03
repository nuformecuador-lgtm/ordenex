// Ficha 470 (T4.7, design §5) — R23: Familia B (el conjunto ya está en el navegador) pierde el tope de
// 5.000. `filasLocales` devuelve TODAS las filas, en orden y sin red, hasta el límite de Excel; por
// encima, el aviso de siempre (cubierto con el tope real en `descarga-resultado.test.ts`, «filasLocales
// rechaza…» y «no trunca»). Con el tope REAL: sin `vi.mock("@/lib/config/descarga")`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { filasLocales } from "@/components/shared/descarga-resultado";
import { descargaConfig } from "@/lib/config/descarga";
import type { DescargaFila } from "@/lib/types/descarga";

interface Item {
  n: number;
}

function items(total: number): Item[] {
  return Array.from({ length: total }, (_, i) => ({ n: total - i }));
}

const proyectar = (item: Item): DescargaFila => ({ n: item.n });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("R23 · Familia B sin tope propio", () => {
  it("el tope del cliente es el límite de Excel, no 5.000", () => {
    expect(descargaConfig.MAX_FILAS).toBe(1_048_575);
  });

  it.each([5_001, 20_000])("%i filas ⇒ ok con TODAS, en el mismo orden y sin llamadas de red", async (total) => {
    const datos = items(total);
    const r = await filasLocales(datos, proyectar);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas).toHaveLength(total);
    expect(r.filas[0]).toEqual({ n: total });
    expect(r.filas[total - 1]).toEqual({ n: 1 });
    expect(r.filas.map((f) => f.n)).toEqual(datos.map((d) => d.n));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("R23/R2 · por encima del tope, el aviso (tope fijado pequeño solo aquí)", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/config/descarga");
    vi.resetModules();
  });

  it("con el tope fijado en 10, 11 filas ⇒ error accionable con total y tope, sin filas", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config/descarga", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/config/descarga")>();
      return { ...real, descargaConfig: { ...real.descargaConfig, MAX_FILAS: 10 } };
    });
    const mod = await import("@/components/shared/descarga-resultado");
    const r = await mod.filasLocales(items(11), proyectar);
    expect(r).toEqual({ status: "error", mensaje: mod.mensajeLimite(11, 10) });
    const enTope = await mod.filasLocales(items(10), proyectar);
    expect(enTope.status).toBe("ok");
  });
});
