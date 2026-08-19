import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import type {
  CrearCierreInput,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// =================================================================================================
// FEATURE 235 (R26) — EL CORTE DE LA NOCHE, MEDIDO DESDE `ejecutarCorte` Y CON EL REPOSITORIO REAL.
//
// POR QUE ESTE ARCHIVO EXISTE. La 235 introdujo una regresion que TRES tests distintos no vieron, y
// el motivo es que todos miraban un nivel por debajo de donde fallaba:
//
//   - `cierre-dia-repository.test.ts` llama a `crearCierre` A MANO -> el barrido escribe bien, pero
//     en produccion a ese mensajero nunca se le llama a `crearCierre`;
//   - `corte-diario-service.test.ts` usa un DOBLE de `ICorteDiarioRepository` -> la lista de
//     mensajeros se la dicta el test, asi que la SELECCION nunca se ejercita;
//   - `corte-diario-repository.test.ts` mide el `where`, pero no que el service lo consuma.
//
// El agujero vivia EN EL CRUCE: la seleccion (`CorteDiarioRepository`) seguia buscando solo
// `en_reparto` mientras la escritura (`CierreDiaRepository`) ya barria los dos estados. Un mensajero
// que recoge una guia, PIDE AYUDA y se va a casa no tenia `gestion_orden` (pedir ayuda no crea
// ninguna) ni orden en `en_reparto`: NO ENTRABA EN EL BUCLE, no recibia su cierre `vencido` y su
// orden no se barria nunca. Antes de la 235 esto funcionaba, porque el booleano dejaba la orden en
// `en_reparto`.
//
// COMO SE MIDE AQUI, y por que asi: `CorteDiarioService` se monta sobre el `CorteDiarioRepository`
// REAL, y ese repositorio sobre un doble de Prisma CON SEMANTICA — el `orden.findMany` aplica de
// verdad el `where` que recibe sobre un conjunto de filas. Asi, romper el `where` del repositorio
// cambia el resultado de `ejecutarCorte`, que es donde el fallo se veia.
// =================================================================================================

interface FilaOrden {
  mensajeroAsignadoId: string | null;
  estatusValue: string;
  deletedAt: Date | null;
  zonaId: string | null;
}

/** El `where` que este repositorio construye, tal como Prisma lo interpretaria. */
interface WhereOrden {
  deletedAt: null;
  estatus: { value: string | { in: string[] } };
  mensajeroAsignadoId: { not: null };
}

/**
 * Doble de Prisma CON SEMANTICA: filtra de verdad. Es lo que convierte este test en una medida del
 * predicado y no en una repeticion de su forma.
 */
function prismaSemantico(filas: FilaOrden[]) {
  const ordenFindMany = vi.fn(async (args: { where: WhereOrden; distinct?: string[] }) => {
    const { where } = args;
    const casa = (f: FilaOrden) => {
      if (f.deletedAt !== null) return false;
      if (f.mensajeroAsignadoId === null) return false;
      const v = where.estatus.value;
      return typeof v === "string" ? f.estatusValue === v : v.in.includes(f.estatusValue);
    };
    const vistos = new Set<string>();
    const out: { mensajeroAsignadoId: string; mensajeroAsignado: { zonaId: string | null } }[] = [];
    for (const f of filas.filter(casa)) {
      const id = f.mensajeroAsignadoId as string;
      if (vistos.has(id)) continue; // `distinct: ["mensajeroAsignadoId"]`
      vistos.add(id);
      out.push({ mensajeroAsignadoId: id, mensajeroAsignado: { zonaId: f.zonaId } });
    }
    return out;
  });
  return {
    // Rama (a) VACIA en todos los casos de este archivo, y a proposito: pedir ayuda NO crea
    // `gestion_orden`, asi que el mensajero de la regresion solo puede entrar por la rama (b).
    gestionOrden: { findMany: vi.fn(async () => []) },
    orden: { findMany: ordenFindMany },
    cierreDia: { findMany: vi.fn(async () => []) },
  };
}

const ESTATUS_IDS: Record<string, string> = {
  en_reparto: "s-reparto",
  ayuda_tienda: "s-ayuda",
  sin_gestionar: "s-sin-gestionar",
};

function build(filas: FilaOrden[]) {
  const prisma = prismaSemantico(filas);
  const corteRepo = new CorteDiarioRepository(prisma as unknown as PrismaClient);
  // El tipo del argumento se declara aqui (y no se castea en cada aserción) para que el
  // `mock.calls` venga tipado: un `vi.fn()` sin parámetros produce tuplas vacías.
  const crearCierre = vi.fn(async (_input: CrearCierreInput): Promise<string | null> => "cv1");
  const cierreRepo = {
    // Sin gestiones sin cerrar: el mensajero de la regresion no tiene NINGUNA.
    findGestionesPendientes: vi.fn(async () => []),
    crearCierre,
  } as unknown as Pick<ICierreDiaRepository, "findGestionesPendientes" | "crearCierre">;
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioVehiculoId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_IDS[v] ?? null),
  } as unknown as IOrdenRepository;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => ({ cobroEntregado: "5.00", cobroRechazado: "3.00" })),
  };
  const service = new CorteDiarioService(
    corteRepo,
    cierreRepo,
    zonaRepo,
    ordenRepo,
    tarifaZonaRepo,
    { warn: vi.fn() },
  );
  return { service, crearCierre, prisma };
}

const enAyuda: FilaOrden = {
  mensajeroAsignadoId: "m-ayuda",
  estatusValue: "ayuda_tienda",
  deletedAt: null,
  zonaId: "z9",
};

describe("235/R26 - `ejecutarCorte` llega al mensajero cuyo dia acabo en `ayuda_tienda`", () => {
  it("le CREA su cierre `vencido` y le pasa los ids del barrido (EL CASO DE LA REGRESION)", async () => {
    const { service, crearCierre } = build([enAyuda]);

    const res = await service.ejecutarCorte();

    // La medida que importa: el mensajero ENTRA en el bucle. Con el `where` del repositorio
    // mirando solo `en_reparto`, esto es 0 y `crearCierre` no se llama ni una vez.
    expect(res).toEqual({ mensajerosEvaluados: 1, vencidosCreados: 1, mensajerosSinZona: 0 });
    expect(crearCierre).toHaveBeenCalledTimes(1);

    const input = crearCierre.mock.calls[0]![0];
    expect(input.mensajeroId).toBe("m-ayuda");
    expect(input.estado).toBe("vencido");
    // Y con el cableado completo, para que el barrido de la escritura tenga de donde partir.
    expect(input.corteSinGestionar?.ayudaEstatusId).toBe("s-ayuda");
    expect(input.corteSinGestionar?.enRepartoEstatusId).toBe("s-reparto");
  });

  it("el de `en_reparto` sigue entrando: es UNION, no sustitucion (109/R4 intacta)", async () => {
    const { service, crearCierre } = build([
      { mensajeroAsignadoId: "m-reparto", estatusValue: "en_reparto", deletedAt: null, zonaId: "z1" },
    ]);

    const res = await service.ejecutarCorte();

    expect(res.vencidosCreados).toBe(1);
    expect(crearCierre.mock.calls[0]![0].mensajeroId).toBe("m-reparto");
  });

  it("los dos a la vez: dos mensajeros, dos cierres", async () => {
    const { service, crearCierre } = build([
      enAyuda,
      { mensajeroAsignadoId: "m-reparto", estatusValue: "en_reparto", deletedAt: null, zonaId: "z1" },
    ]);

    const res = await service.ejecutarCorte();

    expect(res.mensajerosEvaluados).toBe(2);
    expect(res.vencidosCreados).toBe(2);
    const ids = crearCierre.mock.calls.map((c) => c[0].mensajeroId).sort();
    expect(ids).toEqual(["m-ayuda", "m-reparto"]);
  });

  it("109/R5 sigue viva: el de `por_recoger` NO entra - nunca llego a recoger nada", async () => {
    // El caso negativo. Sin el, un `where` que trajera cualquier orden pasaria los tres de arriba.
    const { service, crearCierre } = build([
      { mensajeroAsignadoId: "m-espera", estatusValue: "por_recoger", deletedAt: null, zonaId: "z1" },
    ]);

    const res = await service.ejecutarCorte();

    expect(res).toEqual({ mensajerosEvaluados: 0, vencidosCreados: 0, mensajerosSinZona: 0 });
    expect(crearCierre).not.toHaveBeenCalled();
  });

  it("una orden en ayuda BORRADA no arrastra a su mensajero al corte", async () => {
    const { service, crearCierre } = build([{ ...enAyuda, deletedAt: new Date() }]);

    const res = await service.ejecutarCorte();

    expect(res.mensajerosEvaluados).toBe(0);
    expect(crearCierre).not.toHaveBeenCalled();
  });
});
