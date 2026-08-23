import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";

// Feature 41/C2 (R7/R10) + feature 109 (R4/R10/R29) — repo del corte diario.
// `findMensajerosConActividadSinCierre` devuelve la UNION de (a) mensajeros con gestiones sin
// cerrar (cierre_id IS NULL, anulada_at IS NULL) y (b) mensajeros con >=1 orden en `en_reparto`
// no borrada, menos los que ya tienen un cierre ABIERTO ('solicitado'|'vencido'|'rechazado').
// Mockea Prisma (sin DB real).

// Feature 246 (T2.2): el ancla que el service calcula UNA vez por corrida y pasa a las dos capas.
// Es la fecha CR de la jornada que la corrida CIERRA (`@db.Date`: medianoche UTC). Aqui se fija a
// mano porque este test mide el `where`, no el calculo del ancla (eso es `corte-diario-service`).
const DIA_CERRADO = new Date("2026-08-20T00:00:00.000Z");

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    gestionOrden: { findMany: vi.fn().mockResolvedValue([]) },
    orden: { findMany: vi.fn().mockResolvedValue([]) },
    cierreDia: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe("CorteDiarioRepository.findMensajerosConActividadSinCierre (R7/R10)", () => {
  it("R7: filtra gestiones por cierreId null, distinct por mensajero, trae su zona", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cierreId: null });
    expect(arg.distinct).toEqual(["mensajeroId"]);
    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });

  // Feature 109/R4: la seleccion suma a los mensajeros con ordenes en `en_reparto` (sin gestiones).
  it("R4: incluye mensajeros con >=1 orden en `en_reparto` no borrada (sin gestiones pendientes)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      deletedAt: null,
      // Feature 235 (R26): la rama (b) barre los DOS estados. UNION, no sustitucion.
      estatus: { value: { in: ["en_reparto", "ayuda_tienda"] } },
      mensajeroAsignadoId: { not: null },
    });
    expect(arg.distinct).toEqual(["mensajeroAsignadoId"]);
    expect(rows).toEqual([{ mensajeroId: "m2", zonaId: "z2" }]);
  });

  // Feature 109/R4: UNION sin duplicar — un mensajero con gestiones Y en_reparto aparece 1 vez.
  it("R4: UNION de gestiones + en_reparto, sin duplicar mensajeros", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } }, // ya esta por gestiones
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } }, // nuevo por en_reparto
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows.map((r) => r.mensajeroId).sort()).toEqual(["m1", "m2"]);
    expect(rows.filter((r) => r.mensajeroId === "m1")).toHaveLength(1);
  });

  // ⚠️ ESTOS DOS CASOS SE DIERON LA VUELTA EL 2026-08-23 (FEATURE 271, T3.1/R21). Afirmaban que el
  // corte EXCLUIA al mensajero con un cierre ABIERTO —el invariante 109/R30— y ese invariante queda
  // DEROGADO (R9). Es exactamente lo que rompio el caso medido en produccion: el cierre `79cb2c0f`
  // paso a `solicitado` el 22/08 a las 16:39 y las 2 gestiones de las 16:56 se quedaron con
  // `cierre_id` NULL, porque el corte del 23/08 —que NO fallo— lo resto de su lista.
  //
  // No se borran: se invierten. Perderlos dejaria sin vigilar la propiedad en su direccion nueva,
  // que es la que la ficha existe para conseguir.
  it("271/R21: el mensajero con un cierre ABIERTO YA NO se excluye — entra y recibe el segundo", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
      { mensajeroId: "m2", mensajero: { zonaId: "z2" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows.map((r) => r.mensajeroId).sort()).toEqual(["m1", "m2"]);
    // Y la TERCERA consulta —la que restaba— se fue entera: no es que devuelva vacio, es que ya no
    // se hace. Quien descarta a quien no tiene nada que cerrar es la guarda «algo paso» de
    // `crearCierre`, que ya existia y esta ficha no toca (R22).
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("271/R21: el caso `79cb2c0f` — un `solicitado` de ayer y gestiones de hoy SI entran", async () => {
    const prisma = buildPrisma();
    // El mensajero tiene 2 gestiones sin vincular (las de hoy). Su cierre de ayer sigue
    // `solicitado`, y eso ya no lo saca de la lista.
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m-jose", mensajero: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows).toEqual([{ mensajeroId: "m-jose", zonaId: "z1" }]);
  });

  it("sin actividad (ni gestiones ni en_reparto) -> lista vacia, sin consultar cierres", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows).toEqual([]);
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  // Feature 67/R17: una gestion ANULADA (deshecha) NO es "actividad del dia pendiente de cierre".
  it("67/R17: el WHERE de gestiones exige `anuladaAt: null` (las deshechas no son actividad pendiente)", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ cierreId: null, anuladaAt: null });
  });

  it("propaga zonaId null (P2 lo maneja el service, no el repo)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: null } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: null }]);
  });
});

// =================================================================================================
// FEATURE 235 (R26) — LA SELECCION DEL CORTE TIENE QUE VER LA ORDEN EN AYUDA.
//
// ⚠️ ESTO ES UNA REGRESION QUE LA 235 INTRODUJO Y QUE LA SUITE NO VIO. Mientras la solicitud de
// ayuda fue un BOOLEANO, la orden seguia en `en_reparto` y esta rama la pescaba sola. Al moverla a
// un estatus propio, la rama se quedo mirando el estado viejo: un mensajero que recoge una guia,
// pide ayuda y se va a casa **no entraba en la lista que itera `ejecutarCorte`** —pedir ayuda NO
// crea `gestion_orden`, asi que la rama (a) tampoco lo pesca— y por tanto no se le creaba el cierre
// `vencido` ni se barria su orden NUNCA.
//
// El test que sonaba a que cubria esto (`235/R26: un mensajero cuyo dia entero acabo EN AYUDA...`,
// en `cierre-dia-repository.test.ts`) llama a `crearCierre` A MANO: afirma la propiedad un nivel por
// debajo de donde fallaba. Se conserva —mide la ESCRITURA, que tambien hay que medir— y aqui se
// añade la mitad que faltaba: la SELECCION.
// =================================================================================================
describe("235/R26 — la seleccion del corte alcanza `ayuda_tienda`", () => {
  it("incluye al mensajero cuyo dia entero acabo en `ayuda_tienda`, SIN gestiones pendientes", async () => {
    const prisma = buildPrisma();
    // Rama (a) vacia a proposito: pedir ayuda no crea `gestion_orden`, asi que este mensajero solo
    // puede entrar por la rama (b). Es EL caso de la regresion.
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m-ayuda", mensajeroAsignado: { zonaId: "z9" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows).toEqual([{ mensajeroId: "m-ayuda", zonaId: "z9" }]);
  });

  it("el predicado, aplicado a filas, pesca `en_reparto` Y `ayuda_tienda` y deja fuera el resto", async () => {
    // El `where` es lo unico que decide (este doble no ejecuta SQL), asi que se le da semantica.
    // Sin esto, el caso de arriba pasaria igual con un `where` que trajera CUALQUIER orden.
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);
    const { where } = prisma.orden.findMany.mock.calls[0][0] as {
      where: { deletedAt: null; estatus: { value: { in: string[] } }; mensajeroAsignadoId: unknown };
    };
    const casa = (estatus: string) => where.estatus.value.in.includes(estatus);

    // Los DOS que el corte barre.
    expect(casa("en_reparto")).toBe(true);
    expect(casa("ayuda_tienda")).toBe(true);
    // Y los que NO: `por_recoger` es la guarda de la 109/R5 (el mensajero ni siquiera la recogio),
    // y los desenlaces ya estan cerrados.
    for (const fuera of ["por_recoger", "entregada", "sin_gestionar", "recolectando", "devuelta"]) {
      expect(casa(fuera), `${fuera} NO debe barrerse`).toBe(false);
    }
    // Censo CERRADO: ni uno mas. Un tercer estado aqui barreria trabajo que no toca.
    expect([...where.estatus.value.in].sort()).toEqual(["ayuda_tienda", "en_reparto"]);
  });

  it("UNION sin duplicar: el mensajero con gestiones Y una orden en ayuda aparece UNA vez", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });
});

// =================================================================================================
// FEATURE 246 (T2.2, R11/R12/R14/R18/R19/R20) — LA SELECCION RESPETA EL DIA DE REPARTO.
//
// POR QUE ESTOS CASOS VIVEN AQUI Y NO EN EL SERVICIO. Este repo YA MIDIO CUATRO VECES que una
// mutacion del `where` pasa en verde por los tests de servicio: usan dobles y NO VEN EL SQL. Asi
// que el predicado se prueba donde vive, y con un doble que HONRA el `where` de verdad —filtra
// filas— en vez de un `vi.fn()` mudo que devuelve lo que el test le dicta.
//
// EL PREDICADO: una orden esta PROTEGIDA si `fecha_reparto IS NOT NULL AND fecha_reparto >
// diaCerrado`. Todo lo demas se barre exactamente como antes de esta ficha.
// =================================================================================================

interface FilaSeleccion {
  mensajeroAsignadoId: string;
  estatusValue: string;
  fechaReparto: Date | null;
  deletedAt?: Date | null;
  zonaId?: string | null;
}

/** El `where` que `findMensajerosConActividadSinCierre` construye, tal como Prisma lo leeria. */
interface WhereSeleccion {
  deletedAt: null;
  estatus: { value: { in: string[] } };
  mensajeroAsignadoId: { not: null };
  OR?: { fechaReparto?: null | { lte?: Date } }[];
}

/**
 * Doble de Prisma CON SEMANTICA para `orden.findMany`: aplica de verdad el `where` recibido —
 * incluido el `OR` de fecha— sobre un conjunto de filas. Si el `OR` desapareciera del repositorio,
 * este doble dejaria de filtrar por fecha y los casos de abajo se pondrian ROJOS, que es todo el
 * punto.
 */
function prismaQueHonraElWhere(filas: FilaSeleccion[]) {
  const ordenFindMany = vi.fn(async (args: { where: WhereSeleccion; distinct?: string[] }) => {
    const { where } = args;
    const casaFecha = (f: FilaSeleccion) => {
      if (where.OR === undefined) return true; // sin predicado de fecha: pasa todo (el `where` roto)
      return where.OR.some((rama) => {
        if (rama.fechaReparto === null) return f.fechaReparto === null;
        const lte = rama.fechaReparto?.lte;
        if (lte === undefined) return false;
        return f.fechaReparto !== null && f.fechaReparto.getTime() <= lte.getTime();
      });
    };
    const casa = (f: FilaSeleccion) =>
      (f.deletedAt ?? null) === null &&
      where.estatus.value.in.includes(f.estatusValue) &&
      casaFecha(f);
    const vistos = new Set<string>();
    const out: { mensajeroAsignadoId: string; mensajeroAsignado: { zonaId: string | null } }[] = [];
    for (const f of filas.filter(casa)) {
      if (vistos.has(f.mensajeroAsignadoId)) continue; // `distinct`
      vistos.add(f.mensajeroAsignadoId);
      out.push({
        mensajeroAsignadoId: f.mensajeroAsignadoId,
        mensajeroAsignado: { zonaId: f.zonaId ?? "z1" },
      });
    }
    return out;
  });
  return {
    gestionOrden: { findMany: vi.fn(async () => [] as { mensajeroId: string }[]) },
    orden: { findMany: ordenFindMany },
    cierreDia: { findMany: vi.fn(async () => []) },
  };
}

function seleccionar(filas: FilaSeleccion[], gestiones: { mensajeroId: string }[] = []) {
  const prisma = prismaQueHonraElWhere(filas);
  if (gestiones.length > 0) {
    prisma.gestionOrden.findMany = vi.fn(async () =>
      gestiones.map((g) => ({ mensajeroId: g.mensajeroId, mensajero: { zonaId: "z1" } })),
    ) as unknown as typeof prisma.gestionOrden.findMany;
  }
  const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);
  return repo.findMensajerosConActividadSinCierre(DIA_CERRADO);
}

const MANANA = new Date("2026-08-21T00:00:00.000Z"); // > DIA_CERRADO: RESERVADA
const HOY = new Date("2026-08-20T00:00:00.000Z"); // == DIA_CERRADO: se barre
const AYER = new Date("2026-08-19T00:00:00.000Z"); // < DIA_CERRADO: se barre

describe("246/R11-R14 — el dia de reparto decide quien entra en el corte", () => {
  it("R14: sus UNICAS ordenes son de mañana -> NO entra en el corte (no recibe `vencido`)", async () => {
    // EL caso de la ficha. Con el `OR` fuera del `where`, este mensajero vuelve a entrar, recibe
    // su cierre `vencido` y —desde la 241— queda bloqueado para gestionar y cobrar mañana.
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-manana", estatusValue: "en_reparto", fechaReparto: MANANA },
    ]);
    expect(rows).toEqual([]);
  });

  it("R19/R20: sus ordenes NO tienen dia de reparto -> SI entra, exactamente como antes", async () => {
    // `NULL` significa UNA sola cosa: «no reservada». El predicado no pregunta «¿es de hoy?».
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-sin-fecha", estatusValue: "en_reparto", fechaReparto: null },
    ]);
    expect(rows).toEqual([{ mensajeroId: "m-sin-fecha", zonaId: "z1" }]);
  });

  it("R12: sus ordenes son del dia que la corrida cierra -> SI entra", async () => {
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-hoy", estatusValue: "en_reparto", fechaReparto: HOY },
    ]);
    expect(rows).toEqual([{ mensajeroId: "m-hoy", zonaId: "z1" }]);
  });

  it("R12: sus ordenes son de AYER -> SI entra (la proteccion caduco sola)", async () => {
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-ayer", estatusValue: "en_reparto", fechaReparto: AYER },
    ]);
    expect(rows).toEqual([{ mensajeroId: "m-ayer", zonaId: "z1" }]);
  });

  it("R15: con una reservada Y una de hoy, SI entra — la mezcla no lo protege", async () => {
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-mixto", estatusValue: "en_reparto", fechaReparto: MANANA },
      { mensajeroAsignadoId: "m-mixto", estatusValue: "en_reparto", fechaReparto: HOY },
    ]);
    expect(rows).toEqual([{ mensajeroId: "m-mixto", zonaId: "z1" }]);
  });

  it("la proteccion alcanza tambien a `ayuda_tienda`, no solo a `en_reparto` (235 intacta)", async () => {
    const rows = await seleccionar([
      { mensajeroAsignadoId: "m-ayuda", estatusValue: "ayuda_tienda", fechaReparto: MANANA },
    ]);
    expect(rows).toEqual([]);
  });

  it("R18: la rama de GESTIONES SIN CERRAR no cambia — entra aunque toda su carga sea de mañana", async () => {
    // Es el limite declarado de design §5.3, y es deliberado: el `vencido` nace de TU jornada sin
    // cerrar, no de lo que te asignaron para mañana. Si esto dejara de ser cierto, bastaria con
    // recibir una asignacion nueva cada tarde para no cuadrar caja nunca.
    const rows = await seleccionar(
      [{ mensajeroAsignadoId: "m-gestiones", estatusValue: "en_reparto", fechaReparto: MANANA }],
      [{ mensajeroId: "m-gestiones" }],
    );
    expect(rows).toEqual([{ mensajeroId: "m-gestiones", zonaId: "z1" }]);
  });

  it("R11/R16: el `where` lleva el `OR` con EL MISMO valor de `diaCerrado` que recibio", async () => {
    // La forma, ademas del comportamiento: es la mitad de R16 que se puede medir aqui (la otra
    // mitad —que la escritura diga lo mismo— vive en `cierre-dia-repository.test.ts`).
    const prisma = prismaQueHonraElWhere([]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);
    await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);
    const { where } = prisma.orden.findMany.mock.calls[0]![0] as { where: WhereSeleccion };
    expect(where.OR).toEqual([{ fechaReparto: null }, { fechaReparto: { lte: DIA_CERRADO } }]);
  });

  it("el doble detecta lo que dice detectar (autocomprobacion): sin `OR`, la de mañana entra", async () => {
    // Si el doble dejara de aplicar el filtro de fecha, los casos de arriba pasarian con el `where`
    // roto. Esto lo demuestra: con el `OR` ausente, la reservada NO se filtra.
    const prisma = prismaQueHonraElWhere([
      { mensajeroAsignadoId: "m-manana", estatusValue: "en_reparto", fechaReparto: MANANA },
    ]);
    const sinOr = await prisma.orden.findMany({
      where: {
        deletedAt: null,
        estatus: { value: { in: ["en_reparto", "ayuda_tienda"] } },
        mensajeroAsignadoId: { not: null },
      },
    });
    expect(sinOr).toHaveLength(1);
  });
});
