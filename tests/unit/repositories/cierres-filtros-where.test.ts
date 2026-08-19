import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

// Pedido humano del 2026-08-16 — el WHERE de los FILTROS de los listados de cierres del dia.
//
// Hermano de `colas-paginadas-where.test.ts` y `historicos-paginados-where.test.ts`, y existe
// por la misma leccion que aquellos dejaron escrita: los tests de SERVICIO prueban el
// acotamiento contra un repositorio DOBLE, asi que no ven la traduccion a SQL. Un filtro
// escrito como clave hermana del alcance —en vez de dentro del `AND`— pasaria verde toda la
// suite de servicios y, en produccion, dejaria que un `adminSatelite` viera la bodega vecina.
//
// Cuatro afirmaciones, y ninguna sobra:
//   1. SIN filtros el `where` es EXACTAMENTE el de antes de esta feature (byte a byte): la
//      feature no puede cambiar el camino de quien no filtra;
//   2. el alcance SOBREVIVE al filtro — sigue en el `where` junto a el, no sustituido;
//   3. el filtro de zona de un `adminSatelite` produce una INTERSECCION: pedir la zona ajena
//      da vacio, no la zona ajena;
//   4. las fechas se traducen al dia de CALENDARIO de Costa Rica, con el limite superior
//      EXCLUSIVO del dia siguiente (con `lte` del mismo dia se perderian los cierres de esa
//      ultima jornada, que es justo la que el usuario acaba de pedir).

const RANGO: RangoPagina = { skip: 0, take: 10 };
const ZONA_A = "11111111-1111-4111-8111-111111111111";
const ZONA_B = "22222222-2222-4222-8222-222222222222";
const MENSAJERO = "33333333-3333-4333-8333-333333333333";

const ALCANCE_MAESTRO: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const ALCANCE_SATELITE_A: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: ZONA_A };

function delegado() {
  return {
    findMany: vi.fn(async (_args?: { where?: unknown }) => []),
    count: vi.fn(async (_args?: { where?: unknown }) => 0),
  };
}

function repo(cierreDia: ReturnType<typeof delegado>) {
  return new CierresAdminRepository(
    { cierreDia } as unknown as PrismaClient,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

/** El `where` con el que se pidio la PAGINA (el del conteo se afirma aparte, es el mismo). */
function whereDe(d: ReturnType<typeof delegado>): Record<string, unknown> {
  return d.findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
}

describe("WHERE de los filtros de cierres del dia", () => {
  it("(1) SIN filtros el criterio es el de siempre: ni un `AND` de mas", async () => {
    // La propiedad que protege a quien no filtra. Si esta afirmacion cae, la feature cambio el
    // camino de todos los usuarios para dar servicio a los que filtran.
    const d = delegado();
    await repo(d).findColaPaginada(ALCANCE_MAESTRO, RANGO);

    expect(whereDe(d)).toEqual({
      destinoTipo: "bodega_central",
      estado: { in: [...ESTADOS_COLA_CIERRE_DIA] },
    });
    expect(whereDe(d)).not.toHaveProperty("AND");
  });

  it("(2) el alcance sobrevive al filtro: los dos estan en el `where`, y el conteo usa el mismo", async () => {
    const d = delegado();
    await repo(d).findHistoricoPaginado(ALCANCE_SATELITE_A, RANGO, {
      mensajeroIds: [MENSAJERO],
    });

    const where = whereDe(d);
    // El alcance, intacto y donde estaba.
    expect(where.destinoTipo).toBe("bodega_satelite");
    expect(where.destinoZonaId).toBe(ZONA_A);
    // El filtro, dentro del `AND` — que es lo que hace que se exijan A LA VEZ.
    expect(where.AND).toEqual([{ mensajeroId: { in: [MENSAJERO] } }]);
    // Y el conteo cuenta el MISMO conjunto que la pagina muestra: un total que ignorara el
    // recorte diria «(300)» sobre una lista de 4.
    expect(d.count.mock.calls[0]![0]!.where).toEqual(where);
  });

  it("(3) un `adminSatelite` que filtra por la zona ajena obtiene la INTERSECCION, no la zona ajena", async () => {
    // El caso que da nombre a esta feature en la parte que importa. El `where` resultante exige
    // `destinoZonaId === ZONA_A` (alcance) Y `destinoZonaId IN [ZONA_B]` (filtro): ninguna fila
    // puede cumplir las dos, asi que la respuesta es vacia. Lo que NO puede pasar es que el
    // filtro PISE al alcance y devuelva los cierres de la zona B.
    const d = delegado();
    await repo(d).findColaPaginada(ALCANCE_SATELITE_A, RANGO, { destinoZonaIds: [ZONA_B] });

    const where = whereDe(d);
    expect(where.destinoZonaId, "el filtro sustituyó al alcance en vez de recortarlo").toBe(
      ZONA_A,
    );
    expect(where.AND).toEqual([{ destinoZonaId: { in: [ZONA_B] } }]);
  });

  it("(4) las fechas son el dia de calendario de Costa Rica, con el limite superior exclusivo", async () => {
    const d = delegado();
    await repo(d).findHistoricoCompleto(ALCANCE_MAESTRO, {
      desde: "2026-08-01",
      hasta: "2026-08-16",
    });

    const where = whereDe(d);
    expect(where.AND).toEqual([
      {
        solicitadoAt: {
          gte: inicioDelDiaCREnUtc("2026-08-01"),
          // `lt` del dia SIGUIENTE, no `lte` del mismo dia: con `lte` se caerian los cierres
          // solicitados entre las 00:00 y las 23:59:59.999 del 16, que es el dia que el
          // usuario acaba de pedir.
          lt: inicioDelDiaSiguienteCREnUtc("2026-08-16"),
        },
      },
    ]);
  });

  it("los tres filtros a la vez son TRES condiciones que se exigen todas", async () => {
    const d = delegado();
    await repo(d).findColaCompleta(ALCANCE_MAESTRO, {
      desde: "2026-08-01",
      destinoZonaIds: [ZONA_A, ZONA_B],
      mensajeroIds: [MENSAJERO],
    });

    const where = whereDe(d);
    expect(where.AND).toEqual([
      { solicitadoAt: { gte: inicioDelDiaCREnUtc("2026-08-01") } },
      { destinoZonaId: { in: [ZONA_A, ZONA_B] } },
      { mensajeroId: { in: [MENSAJERO] } },
    ]);
    // Y el corte cola/historico sigue siendo el de la particion: filtrar no lo toca.
    expect(where.estado).toEqual({ in: [...ESTADOS_COLA_CIERRE_DIA] });
  });

  it("solo `hasta` recorta por arriba y deja abierto el comienzo", async () => {
    const d = delegado();
    await repo(d).findColaPaginada(ALCANCE_MAESTRO, RANGO, { hasta: "2026-08-16" });

    expect(whereDe(d).AND).toEqual([
      { solicitadoAt: { lt: inicioDelDiaSiguienteCREnUtc("2026-08-16") } },
    ]);
  });
});
