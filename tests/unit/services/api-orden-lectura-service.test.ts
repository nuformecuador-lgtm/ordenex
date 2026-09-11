// BAJA (2026-08-31) — este archivo cubria tambien `ApiOrdenLecturaService.detalle(actor, numGuia)`
// y sus evidencias de incidente (268/R27). El metodo se retiro con su endpoint
// (`GET /api/ordenes/api-key/{numGuia}`) y esa cobertura NO se pierde: vive intacta, caso por
// caso, en `api-orden-lectura-service.por-orden-id.test.ts`, que afirma lo mismo sobre
// `detallePorOrdenId` —el mismo mapeo, el mismo firmado y el mismo `OrdenRepository` real sobre
// Prisma mockeado—. Aqui queda `listar`.
import { describe, it, expect, vi } from "vitest";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
// ⏳ 2026-09-10 (feature 415): los dos campos nuevos de la fila del repo.
import {
  congeladoFixture,
  costeoFixture,
  TARIFA_FIXTURE,
  ZONA_FIXTURE,
} from "@/tests/fixtures/api-orden-costeo-415";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

function row(overrides: Partial<ApiOrdenRow> = {}): ApiOrdenRow {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    // ⏳ 2026-09-09 (feature 404): campo REQUERIDO de `ApiOrdenRow`. Por defecto, sin asignado.
    mensajero: null,
    // ⏳ 2026-09-10 (feature 415): campos REQUERIDOS de `ApiOrdenRow`. `zona` se publica; `costeo`
    // NO. El defecto no resuelve ninguna tarifa, asi que `costoEstimado` sale `null`: los casos
    // que afirman importes montan su propia tarifa.
    zona: ZONA_FIXTURE,
    costeo: costeoFixture(),
    ...overrides,
  };
}

/** ⏳ 2026-09-09 (404) — el mensajero que devolveria el repo, ya compuesto por el repositorio. */
const MENSAJERO = { id: "018f2c31-0000-4000-8000-0000000000aa", nombre: "Carlos Jimenez Mora" };

function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listByOwner: vi.fn().mockResolvedValue({ items: [row()], total: 1 }),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(null),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    ...overrides,
  };
}

/**
 * ⏳ 2026-09-10 (feature 415): el resolutor de tarifa VIGENTE. Por defecto NO resuelve ninguna, que
 * es el caso de `costoEstimado: null` (R22). Los casos que quieren importes pasan su mapa.
 */
function fakeTarifas(entradas: Array<[string, unknown]> = []) {
  return { resolveTarifas: vi.fn().mockResolvedValue(new Map(entradas)) };
}

function fakeSignedUrls(map: Record<string, string> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async () => "https://signed/one"),
    createSignedUrls: vi.fn(async () => map),
  };
}

describe("ApiOrdenLecturaService.listar (feature 106, T8)", () => {
  it("R4/R6: usa actor.usuarioId como owner (no un input) al llamar al repo", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);
    await svc.listar(ACTOR, { limit: 50, offset: 0 });
    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: undefined,
      skip: 0,
      take: 50,
    });
  });

  it("R8: el filtro estado se resuelve a estatusId; no amplia scope", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);
    await svc.listar(ACTOR, { limit: 20, offset: 40, estado: "en_bodega_central" });
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_bodega_central");
    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: "os-bodega",
      skip: 40,
      take: 20,
    });
  });

  it("estado valido sin id en el catalogo -> pagina vacia con total 0 (no consulta el listado)", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0, estado: "devuelta_a_tienda" });
    expect(res).toEqual({ items: [], pagination: { limit: 50, offset: 0, total: 0 } });
    expect(repo.listByOwner).not.toHaveBeenCalled();
  });

  it("R10: devuelve items publicos (estado plano) + pagination con total", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });
    expect(res.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
    expect(res.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega_central" });
    expect(res.items[0]).not.toHaveProperty("estatusValue");
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-09 — Feature 404 (T5): el DTO del item lleva `mensajero`, tal cual lo dio el repo.
// -----------------------------------------------------------------------------------------------

describe("ApiOrdenLecturaService.listar — `mensajero` en el DTO (feature 404)", () => {
  it("404/R14: el DTO del item lleva `mensajero` TAL CUAL lo dio el repo (no lo recompone)", async () => {
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({ items: [row({ mensajero: MENSAJERO })], total: 1 }),
    });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].mensajero).toEqual({
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jimenez Mora",
    });
  });

  it("404/R1+R6: el objeto `mensajero` del DTO tiene EXACTAMENTE dos claves", async () => {
    // El repo devuelve una fila con un campo de mas (lo que pasaria si alguien ampliara la
    // proyeccion sin actualizar el tipo): el DTO no debe dejarlo pasar por copia ciega.
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [row({ mensajero: MENSAJERO })],
        total: 1,
      }),
    });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(Object.keys(res.items[0].mensajero!).sort()).toEqual(["id", "nombre"]);
    // ⏳ 2026-09-10 (feature 415, R9/R34) — ENMENDADO, no relajado. Aqui decia «los nueve
    // publicados + `mensajero`, ni uno mas (R16)» y eran DIEZ claves. La 415 anade TRES campos
    // ADITIVOS —`zona`, `costoEstimado` y `costoReal`— y el conjunto exacto pasa a TRECE. Sigue
    // siendo una igualdad de la lista entera: si alguien colara una clave por un spread, esto se
    // pone rojo y dice cual. Las diez de antes siguen ahi, con el mismo nombre.
    expect(Object.keys(res.items[0]).sort()).toEqual([
      "costoEstimado",
      "costoReal",
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
      "zona",
    ]);
  });

  it("404/R2+R23: sin asignado el DTO lleva la clave con `null`, no la omite", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect("mensajero" in res.items[0]).toBe(true);
    expect(res.items[0].mensajero).toBeNull();
    expect(JSON.stringify(res.items[0])).toContain('"mensajero":null');
  });

  it("404/R17: `mensajero` no llega al repo como criterio: los params del listado no cambian", async () => {
    // El service traduce `estado`/`desde`/`hasta`/`numGuia`/`numRemision` y NADA MAS. Si alguien
    // anadiera un filtro por mensajero, esta igualdad exacta de argumentos se pondria roja.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: undefined,
      skip: 0,
      take: 50,
    });
    const args = repo.listByOwner.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("mensajero");
    expect(args).not.toHaveProperty("mensajeroAsignadoId");
    expect(args).not.toHaveProperty("orderBy");
  });
});


// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-10 — Feature 415 (T4): `zona`, `costoEstimado` y `costoReal` en el DTO del item.
//
// ⚠️ TODOS LOS IMPORTES ESPERADOS ESTAN ESCRITOS A MANO, con la aritmetica anotada al lado. Ni un
// solo `expect(x).toBe(costoEstimadoDe(...))`: comparar un importe contra la funcion que lo calcula
// esta siempre verde, y en esta ficha es la trampa numero uno.
// -----------------------------------------------------------------------------------------------

/** Clave del Map de tarifas, con el formato real de `clavePar` (`tiendaId|zonaId`). */
const CLAVE_GAM = `store-1|${ZONA_FIXTURE.id}`;

/**
 * La aritmetica, hecha aparte y a mano, con la tarifa de `TARIFA_FIXTURE`:
 *   flete        = valorFleteGam                      = 2500.00  (esCentral: true elige la columna GAM)
 *   iva          = 2500.00 x 13 %                     =  325.00
 *   comision     = 25900.00 x 3.50 %                  =  906.50
 *   ivaComision  = 906.50 x 13 % = 117.845 -> HALF_UP =  117.85
 *   fulfillment  = tarifa.fulfillment                 =  696.00
 */
const COSTO_ESPERADO_VIGENTE = {
  flete: "2500.00",
  iva: "325.00",
  comision: "906.50",
  ivaComision: "117.85",
  fulfillment: "696.00",
};

/** Las entradas VIVAS que producen ese costo. Mismos numeros, escritos una sola vez. */
const ENTRADAS_VIVAS = {
  esCentral: true,
  esZonaEspecial: false,
  montoCobrar: "25900.00",
  cobraComision: true,
};

describe("ApiOrdenLecturaService.listar — zona y costo (feature 415)", () => {
  it("415/R1+R2: `zona` viaja con `{id, nombre}`, nunca es null y no lleva `esCentral`", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].zona).toEqual({
      id: "018f2c31-0000-4000-8000-00000000za01",
      nombre: "GAM",
    });
    expect(res.items[0].zona).not.toBeNull();
    expect(Object.keys(res.items[0].zona).sort()).toEqual(["id", "nombre"]);
    expect(JSON.stringify(res.items[0])).not.toContain("esCentral");
  });

  it("415/R9+R10+R19: con tarifa vigente, `costoEstimado` son los CINCO conceptos exactos", async () => {
    const repo = fakeRepo({
      listByOwner: vi
        .fn()
        .mockResolvedValue({ items: [row({ costeo: costeoFixture(ENTRADAS_VIVAS) })], total: 1 }),
    });
    const svc = new ApiOrdenLecturaService(
      repo as never,
      fakeSignedUrls(),
      fakeTarifas([[CLAVE_GAM, TARIFA_FIXTURE]]) as never,
    );

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    // Igualdad ESTRUCTURAL contra los literales de arriba: cinco claves, ni una mas.
    expect(res.items[0].costoEstimado).toEqual(COSTO_ESPERADO_VIGENTE);
    expect(Object.keys(res.items[0].costoEstimado!).sort()).toEqual([
      "comision",
      "flete",
      "fulfillment",
      "iva",
      "ivaComision",
    ]);
  });

  it("415/R22: sin tarifa para el par, `costoEstimado` es `null` y NO cinco ceros", async () => {
    const repo = fakeRepo({
      listByOwner: vi
        .fn()
        .mockResolvedValue({ items: [row({ costeo: costeoFixture(ENTRADAS_VIVAS) })], total: 1 }),
    });
    // El Map trae la entrada del par pedido con `null`: es lo que devuelve el resolver cuando
    // ningun nivel de la cascada tiene fila.
    const svc = new ApiOrdenLecturaService(
      repo as never,
      fakeSignedUrls(),
      fakeTarifas([[CLAVE_GAM, null]]) as never,
    );

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].costoEstimado).toBeNull();
    // La clave VIAJA igualmente (R9): `null` explicito, nunca omitida.
    expect("costoEstimado" in res.items[0]).toBe(true);
    expect(JSON.stringify(res.items[0])).toContain('"costoEstimado":null');
  });

  it("415/R26: `costoReal` es `null` cuando el repo no trajo fila congelada", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].costoReal).toBeNull();
    expect("costoReal" in res.items[0]).toBe(true);
  });

  it('415/R22+R28: la ASIMETRIA — sin tarifa el estimado es null y el real son cinco "0.00"', async () => {
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [row({ costeo: costeoFixture({ congelado: congeladoFixture() }) })],
        total: 1,
      }),
    });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    // ⭑ LAS DOS MITADES EN EL MISMO BLOQUE PARA QUE SE LEA: el ESTIMADO sin tarifa es `null`
    // (un cero mentiria: prometeria un envio gratis que si se cobrara en cuanto haya tarifa) y el
    // REAL sin tarifa congelada son cinco ceros AFIRMADOS (ese cierre liquido cero de verdad).
    // Design §D7 / §D8. Separadas parecen una inconsistencia; juntas se ve que no lo son.
    expect(res.items[0].costoEstimado).toBeNull();
    expect(res.items[0].costoReal).toEqual({
      flete: "0.00",
      iva: "0.00",
      comision: "0.00",
      ivaComision: "0.00",
      fulfillment: "0.00",
    });
  });

  it("415/R29: el `fulfillment` de `costoReal` sale del CONGELADO y difiere del vigente", async () => {
    // El caso MEDIDO en produccion: la tarifa cambio de 692,00 a 696,00 en 263 de 1.581 detalles.
    // Los dos valores van a mano y son DISTINTOS: si el mapeo tomara el fulfillment vigente para
    // el congelado, los dos saldrian 696.00 y este aserto se pondria rojo.
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [
          row({
            costeo: costeoFixture({
              ...ENTRADAS_VIVAS,
              congelado: congeladoFixture({
                tarifa: TARIFA_FIXTURE,
                fulfillment: "692.00",
                ...ENTRADAS_VIVAS,
              }),
            }),
          }),
        ],
        total: 1,
      }),
    });
    const svc = new ApiOrdenLecturaService(
      repo as never,
      fakeSignedUrls(),
      fakeTarifas([[CLAVE_GAM, TARIFA_FIXTURE]]) as never,
    );

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].costoEstimado!.fulfillment).toBe("696.00");
    expect(res.items[0].costoReal!.fulfillment).toBe("692.00");
    // Los otros cuatro conceptos SI coinciden (misma tarifa, mismas entradas), y es lo que hace
    // que la diferencia del fulfillment sea inconfundible.
    expect(res.items[0].costoReal).toEqual({ ...COSTO_ESPERADO_VIGENTE, fulfillment: "692.00" });
  });

  it("415/R24: 3 ordenes en 2 zonas -> UNA llamada a `resolveTarifas` con los 2 pares DISTINTOS", async () => {
    const OTRA_ZONA = { id: "018f2c31-0000-4000-8000-00000000za07", nombre: "FGAM Limon" };
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [
          row({ numRemision: "R-1" }),
          row({
            numRemision: "R-2",
            zona: OTRA_ZONA,
            costeo: costeoFixture({ zonaId: OTRA_ZONA.id }),
          }),
          // La TERCERA repite la zona de la primera: el par no se pide dos veces.
          row({ numRemision: "R-3" }),
        ],
        total: 3,
      }),
    });
    const tarifas = fakeTarifas();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), tarifas as never);

    await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(tarifas.resolveTarifas).toHaveBeenCalledTimes(1);
    // 415/R32: el par lleva el `usuarioId` DEL ACTOR, nunca un `tiendaId` del input.
    expect(tarifas.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: "store-1", zonaId: ZONA_FIXTURE.id },
      { tiendaId: "store-1", zonaId: OTRA_ZONA.id },
    ]);
  });

  it("415/R24: una pagina VACIA no llama a `resolveTarifas` ni una vez", async () => {
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    const tarifas = fakeTarifas();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), tarifas as never);

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items).toEqual([]);
    expect(tarifas.resolveTarifas).not.toHaveBeenCalled();
  });

  it("415/R7+R18: ni la zona ni el costo llegan al repo como criterio", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls(), fakeTarifas() as never);

    await svc.listar(ACTOR, { limit: 50, offset: 0 });

    const args = repo.listByOwner.mock.calls[0][0] as Record<string, unknown>;
    for (const clave of ["zona", "zonaId", "costoEstimado", "costoReal", "flete", "orderBy"]) {
      expect(args).not.toHaveProperty(clave);
    }
  });

  it("415/R18+R35: el item NO publica la procedencia interna de los importes", async () => {
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [
          row({
            costeo: costeoFixture({
              ...ENTRADAS_VIVAS,
              congelado: congeladoFixture({ tarifa: TARIFA_FIXTURE, fulfillment: "692.00" }),
            }),
          }),
        ],
        total: 1,
      }),
    });
    const svc = new ApiOrdenLecturaService(
      repo as never,
      fakeSignedUrls(),
      fakeTarifas([[CLAVE_GAM, TARIFA_FIXTURE]]) as never,
    );

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    const texto = JSON.stringify(res.items[0]);
    // `costeo` entero se queda dentro: ni el id de la tarifa, ni el del cierre, ni el `zonaId`
    // suelto, ni las entradas congeladas cruzan al DTO.
    expect(res.items[0]).not.toHaveProperty("costeo");
    for (const fuga of ["costeo", "tarifaId", "tarifa-1", "cierreId", "zonaId", "esZonaEspecial"]) {
      expect(texto).not.toContain(fuga);
    }
  });
});
