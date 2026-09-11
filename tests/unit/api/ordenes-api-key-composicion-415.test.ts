import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * ⏳ 2026-09-10 — FEATURE 415 (T5): LOS DOS COMPOSITION ROOTS INYECTAN DE VERDAD.
 *
 * ⚠️ POR QUE ESTO ES UNA TASK PROPIA, y no un detalle del service. En este repo ya se MIDIO el modo
 * de fallo exacto: un composition root que **importa** una dependencia y no la **pasa**, dejando el
 * camino muerto con la suite entera en verde (2 de 7 notificadores muertos). Un `import` sin uso no
 * puede poner este archivo en verde: aqui se ejercita la cadena REAL —el route handler SIN
 * `deps.lecturaService`, para que corra `buildLecturaService()` de produccion— y se comprueba que
 * `costoEstimado` SALE CON IMPORTES.
 *
 * Si alguien quitara `new TarifaVigenteRepository(prisma)` del builder, el service se quedaria sin
 * `resolveTarifas` y estos casos se pondrian rojos de inmediato.
 *
 * Lo unico mockeado es la FRONTERA con el exterior: el cliente de Prisma y el firmador de Storage.
 * Todo lo de en medio —`OrdenRepository`, `ApiOrdenLecturaService`, `TarifaVigenteRepository`, el
 * modulo de costo— es el codigo de produccion.
 */

const ORDEN_ID = "3f6a1c2e-0000-4000-8000-000000000001";
const OWNER = "u-key-1";
const ZONA_ID = "018f2c31-0000-4000-8000-00000000za01";
const SECRETO = "ordx_secretovivo1234567890";

/** La fila de `orden` que el `select` del canal devuelve, con las relaciones que pide. */
function filaOrden(over: Record<string, unknown> = {}) {
  return {
    numGuia: 100234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal("25900.00"),
    createdAt: new Date("2026-09-10T10:00:00.000Z"),
    estatus: { value: "en_reparto" },
    mensajeroAsignado: null,
    zonaId: ZONA_ID,
    cobraComision: true,
    zona: { id: ZONA_ID, nombre: "GAM", esCentral: true },
    distrito: { zonaEspecial: false },
    cierreDetalles: [],
    gestiones: [],
    historialEstados: [],
    incidentesAdmin: [],
    ...over,
  };
}

/**
 * La fila de `tarifas` que `TarifaVigenteRepository.resolveTarifas` lee. Nivel 1 de la cascada
 * (tienda + zona), que es el que resuelve para esta orden.
 */
const FILA_TARIFA = {
  id: "tarifa-1",
  tiendaId: OWNER,
  zonaId: ZONA_ID,
  fulfillment: new Prisma.Decimal("696.00"),
  valorFlete: new Prisma.Decimal("3000.00"),
  valorFleteGam: new Prisma.Decimal("2500.00"),
  valorFleteDevuelto: new Prisma.Decimal("1500.00"),
  valorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
  comisionCod: new Prisma.Decimal("3.50"),
  ivaFlete: new Prisma.Decimal("13.00"),
  ivaComisionCod: new Prisma.Decimal("13.00"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Los importes esperados, ESCRITOS A MANO con la aritmetica anotada (nunca derivados de la funcion
 * bajo prueba):
 *   flete       = valorFleteGam (esCentral: true)   = 2500.00
 *   iva         = 2500.00 x 13 %                    =  325.00
 *   comision    = 25900.00 x 3.50 %                 =  906.50
 *   ivaComision = 906.50 x 13 % = 117.845 -> HALF_UP=  117.85
 *   fulfillment = tarifas.fulfillment               =  696.00
 */
const COSTO_ESPERADO = {
  flete: "2500.00",
  iva: "325.00",
  comision: "906.50",
  ivaComision: "117.85",
  fulfillment: "696.00",
};

const prismaFalso = {
  orden: {
    findMany: vi.fn(async () => [filaOrden()]),
    count: vi.fn(async () => 1),
    findFirst: vi.fn(async () => filaOrden()),
  },
  tarifa: { findMany: vi.fn(async () => [FILA_TARIFA]) },
};

// La frontera con el exterior, y SOLO ella.
vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => prismaFalso,
  PRISMA_OMIT: { orden: { busquedaTexto: true } },
}));
vi.mock("@/lib/storage/SupabaseSignedUrlProvider", () => ({
  SupabaseSignedUrlProvider: class {
    async createSignedUrl() {
      return "https://signed/one";
    }
    async createSignedUrls() {
      return {};
    }
  },
}));

const { handleListadoApi } = await import("@/app/api/ordenes/api-key/route");
const { handleConsultaOrdenApi } = await import("@/app/api/ordenes/api-key/orden/[id]/route");

const ACTOR = { usuarioId: OWNER, rol: "apiKey" as const };
const autenticar = async () => ({ status: "ok" as const, actor: ACTOR });

function req(url: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${SECRETO}` } });
}

beforeEach(() => {
  prismaFalso.tarifa.findMany.mockClear();
  prismaFalso.orden.findMany.mockClear();
  prismaFalso.orden.findFirst.mockClear();
});

describe("415/T5 — el composition root del LISTADO pasa el resolutor de tarifas", () => {
  it("sin `deps.lecturaService`, la cadena REAL produce `costoEstimado` con importes", async () => {
    // ⭑ SIN `lecturaService` A PROPOSITO: asi corre `buildLecturaService()`, el de produccion.
    const res = await handleListadoApi(req("http://localhost/api/ordenes/api-key?limit=50"), {
      autenticar,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    // Si el builder no PASARA el `TarifaVigenteRepository`, esto seria `null` (o un 500).
    expect(json.items[0].costoEstimado).toEqual(COSTO_ESPERADO);
    expect(json.items[0].zona).toEqual({ id: ZONA_ID, nombre: "GAM" });
  });

  it("y el resolutor va de verdad a `tarifas` con el par (owner, zona de la orden)", async () => {
    await handleListadoApi(req("http://localhost/api/ordenes/api-key?limit=50"), { autenticar });

    // UNA sola consulta de tarifas para la pagina (R24), y con el OWNER de la peticion (R32).
    expect(prismaFalso.tarifa.findMany).toHaveBeenCalledTimes(1);
    const where = JSON.stringify(prismaFalso.tarifa.findMany.mock.calls[0][0].where);
    expect(where).toContain(OWNER);
    expect(where).toContain(ZONA_ID);
  });
});

describe("415/T5 — el composition root del DETALLE pasa el mismo resolutor", () => {
  it("sin `deps.detallePorOrdenId`, la cadena REAL produce `costoEstimado` con importes", async () => {
    const res = await handleConsultaOrdenApi(
      req(`http://localhost/api/ordenes/api-key/orden/${ORDEN_ID}`),
      "100234",
      {
        autenticar,
        // Se inyecta SOLO la resolucion del `{id}` (que es de otra feature y necesitaria mas
        // dobles); el detalle en si lo construye `buildDetallePorOrdenId()` de produccion, que es
        // lo que esta task vigila.
        resolucionService: {
          resolver: async () => ({
            status: "ok" as const,
            orden: { id: ORDEN_ID, numGuia: 100234, numRemision: "REM-1" },
          }),
        } as never,
      },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.costoEstimado).toEqual(COSTO_ESPERADO);
    expect(json.zona).toEqual({ id: ZONA_ID, nombre: "GAM" });
    // El detalle conserva lo suyo: los dos arrays siguen ahi.
    expect(json.evidencias).toEqual([]);
    expect(json.gestiones).toEqual([]);
  });
});
