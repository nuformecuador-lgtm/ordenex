import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { diaQueElCorteCierra } from "@/lib/services/CorteDiarioService";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * FICHA 425 (B5) — QUE RECHAZOS DE TIENDA SE LLEVA UN CIERRE, EJECUTADO CONTRA POSTGRES.
 *
 * POR QUE CONTRA POSTGRES. Lo que se prueba es un `where` con un filtro de relacion `some` (un
 * `EXISTS` correlacionado), un filtro 1-a-1 `is: null` y un `createMany` con `skipDuplicates` sobre un
 * `UNIQUE`. Un doble no ve nada de eso: en este repo una mutacion de un `where` ya paso en verde CUATRO
 * veces por arriba. Molde: `cierre-excluye-gestiones-de-escritorio.test.ts` (337).
 *
 * CADA CASO USA UN MENSAJERO RECIEN CREADO: la base de desarrollo arrastra gestiones sueltas de otras
 * corridas, y con ellas por medio un `toEqual` de conjuntos no diria nada.
 *
 * LOS DOS CERROJOS DE D2, UNO POR CASO. `resultado: "rechazada"` y el `some` por `rechazo_tienda`
 * protegen lo mismo —que una reprogramacion de tienda no se cuele— y una reprogramacion REAL falla los
 * dos a la vez. Por eso cada cerrojo solo se VE cuando el otro no esta: los dos casos «cerrojo»
 * siembran a proposito una fila CRUZADA que ninguna via de la app produce hoy, para que quitar UNO
 * SOLO de los dos ponga este archivo rojo. La contraprueba de mutacion esta en `progress/impl_425.md`.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`); CON base pero SIN catalogo, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f425s${Date.now().toString(36)}`;
const GUIA_BASE = 425_000_000 + (Date.now() % 50_000_000);

const CALLE: OrdenHistorialOrigenTipo = "gestion";
const AYUDA: OrdenHistorialOrigenTipo = "gestion_tienda_ayuda";
const RECHAZO_TIENDA: OrdenHistorialOrigenTipo = "rechazo_tienda";
const REPRO_TIENDA: OrdenHistorialOrigenTipo = "reprogramacion_tienda";

type Resultado = "entregado" | "devolucion_a_origen_por_rechazo" | "reprogramado";

const INPUT_CIERRE_VACIO = {
  destinoTipo: "bodega_central" as const,
  totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
  pagoByGestionId: {},
  totalPagoMensajero: "0.00",
  ingresoByGestionId: {},
  totalIngresoBodegaRechazos: "0.00",
};

interface Semilla {
  gestionId: string;
  ordenId: string;
  numRemision: string;
  numGuia: number | null;
}

describeSiHayBase("425/B5 — el cierre incorpora los rechazos de tienda que le tocan, contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  let n = 0;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) {
      throw new Error("hace falta al menos UN usuario en la base para prestar las FKs de catalogo.");
    }
    fksUsuario = usuario;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function crearMensajero(tx: TxDeTest): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero 425 ${clave}`,
        email: `m425-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `425${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /**
   * Una gestion SUELTA (`cierre_id NULL`) con su fila de historial enlazada, escrita DIRECTA (sin el
   * choke point) por la misma razon que en el test de la 337: lo que se mide es el `where` del cierre,
   * y para eso la fila solo tiene que existir con su `origen_tipo` y su `gestion_orden_id`.
   */
  async function sembrarGestion(
    tx: TxDeTest,
    mensajeroId: string,
    origenTipo: OrdenHistorialOrigenTipo,
    resultado: Resultado,
    extra: { createdAt?: Date; numGuia?: number | null; motivo?: string | null; remision?: string } = {},
  ): Promise<Semilla> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const numRemision = extra.remision ? `${extra.remision}-${clave}` : `R-${clave}`;
    const numGuia = extra.numGuia === undefined ? GUIA_BASE + n : extra.numGuia;
    const orden = await tx.orden.create({
      data: {
        numGuia,
        numRemision,
        destinatario: `Dest ${clave}`,
        telefonoDest: "88880000",
        producto: `Prod ${clave}`,
        estatusId: fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId: orden.id,
        mensajeroId,
        resultado,
        cierreId: null,
        motivo: extra.motivo ?? null,
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      },
      select: { id: true },
    });
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId: orden.id,
        estatusOrigenId: null,
        estatusDestinoId: fks.estatusId,
        actorUsuarioId: null,
        origenTipo,
        gestionOrdenId: gestion.id,
      },
    });
    return { gestionId: gestion.id, ordenId: orden.id, numRemision, numGuia };
  }

  function repoDe(tx: TxDeTest) {
    return new CierreDiaRepository(
      tx as unknown as PrismaClient,
      new TarifaVigenteRepository(tx as unknown as PrismaClient),
    );
  }

  function crearCierre(tx: TxDeTest, mensajeroId: string, estado?: "vencido") {
    return repoDe(tx).crearCierre({
      ...INPUT_CIERRE_VACIO,
      mensajeroId,
      destinoZonaId: fks.zonaId,
      ...(estado ? { estado } : {}),
    });
  }

  async function vinculosDelCierre(tx: TxDeTest, cierreId: string | null): Promise<string[]> {
    if (cierreId === null) return [];
    const filas = await tx.cierreRechazoTienda.findMany({
      where: { cierreId },
      select: { gestionId: true },
    });
    return filas.map((f) => f.gestionId).sort();
  }

  async function cierresQueVinculan(tx: TxDeTest, gestionId: string): Promise<string[]> {
    const filas = await tx.cierreRechazoTienda.findMany({
      where: { gestionId },
      select: { cierreId: true },
    });
    return filas.map((f) => f.cierreId);
  }

  async function cierreIdPorGestion(
    tx: TxDeTest,
    gestionIds: string[],
  ): Promise<Record<string, string | null>> {
    const filas = await tx.gestionOrden.findMany({
      where: { id: { in: gestionIds } },
      select: { id: true, cierreId: true },
    });
    return Object.fromEntries(filas.map((f) => [f.id, f.cierreId]));
  }

  it("R1/R18: incorpora el rechazo suelto como VINCULO; calle y ayuda facturan como siempre; la reprogramacion no entra", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const calle = await sembrarGestion(tx, mensajeroId, CALLE, "entregado");
      const ayuda = await sembrarGestion(tx, mensajeroId, AYUDA, "devolucion_a_origen_por_rechazo");
      const rechazo = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo");
      const repro = await sembrarGestion(tx, mensajeroId, REPRO_TIENDA, "reprogramado");
      const cierreId = await crearCierre(tx, mensajeroId);
      const ids = {
        calle: calle.gestionId,
        ayuda: ayuda.gestionId,
        rechazo: rechazo.gestionId,
        repro: repro.gestionId,
      };
      return {
        ids,
        cierreId,
        vinculos: await vinculosDelCierre(tx, cierreId),
        vinculosDeLaRepro: await cierresQueVinculan(tx, repro.gestionId),
        porGestion: await cierreIdPorGestion(tx, Object.values(ids)),
      };
    });

    expect(m.cierreId).not.toBeNull();
    // EL CONJUNTO EXACTO DEL VINCULO: el rechazo de tienda y nada mas.
    expect(m.vinculos).toEqual([m.ids.rechazo]);
    // R18: la calle y la ayuda reciben `cierre_id`, como antes de la ficha.
    expect(m.porGestion[m.ids.calle]).toBe(m.cierreId);
    expect(m.porGestion[m.ids.ayuda]).toBe(m.cierreId);
    // El rechazo SE VE pero NO FACTURA: sigue sin `cierre_id`.
    expect(m.porGestion[m.ids.rechazo]).toBeNull();
    // R17: la reprogramacion no esta en ninguna de las dos tablas.
    expect(m.porGestion[m.ids.repro]).toBeNull();
    expect(m.vinculosDeLaRepro).toEqual([]);
  });

  it("R3: un rechazo ya vinculado no lo recoge un cierre posterior, y la base impide que otro cierre se lo lleve", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const r1 = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo");
      const c1 = await crearCierre(tx, mensajeroId);
      // El dia siguiente: una gestion de calle y un rechazo NUEVO.
      await sembrarGestion(tx, mensajeroId, CALLE, "entregado");
      const r2 = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo");
      const c2 = await crearCierre(tx, mensajeroId);
      if (c1 === null || c2 === null) {
        throw new Error(`los dos cierres tenian que crearse: c1=${c1} c2=${c2}`);
      }
      // LA RED DE LA BASE, sin pasar por el predicado: un segundo vinculo para r1, en c2.
      const forzado = await tx.cierreRechazoTienda.createMany({
        data: [
          {
            cierreId: c2,
            gestionId: r1.gestionId,
            ordenId: r1.ordenId,
            numRemision: r1.numRemision,
            destinatario: "x",
            producto: "x",
            tiendaNombre: "x",
            zonaNombre: "x",
            rechazadoAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      return {
        c1,
        r1: r1.gestionId,
        r2: r2.gestionId,
        enC1: await vinculosDelCierre(tx, c1),
        enC2: await vinculosDelCierre(tx, c2),
        insertadasPorLaFuerza: forzado.count,
        cierresDeR1: await cierresQueVinculan(tx, r1.gestionId),
      };
    });

    expect(m.enC1).toEqual([m.r1]);
    // El NUEVO si, el viejo NO: c2 no se vuelve a llevar r1.
    expect(m.enC2).toEqual([m.r2]);
    // Y aunque alguien se saltara el predicado, el UNIQUE(gestion_id) no admite la segunda fila.
    expect(m.insertadasPorLaFuerza).toBe(0);
    expect(m.cierresDeR1).toEqual([m.c1]);
  });

  it("R4: una segunda corrida no duplica el vinculo ni crea un segundo cierre", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const r = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo");
      const primera = await crearCierre(tx, mensajeroId, "vencido");
      const segunda = await crearCierre(tx, mensajeroId, "vencido");
      return {
        primera,
        segunda,
        vinculos: await tx.cierreRechazoTienda.count({ where: { gestionId: r.gestionId } }),
        cierres: await tx.cierreDia.count({ where: { mensajeroId } }),
      };
    });

    expect(m.primera).not.toBeNull();
    expect(m.segunda).toBeNull();
    expect(m.vinculos).toBe(1);
    expect(m.cierres).toBe(1);
  });

  it("R5: el mensajero SOLO con rechazos de tienda ahora SI obtiene cierre, y el corte lo selecciona (caso Arnel)", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const ids: string[] = [];
      for (const remision of ["NA-947", "NA-981", "NA-1103"]) {
        const s = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo", { remision });
        ids.push(s.gestionId);
      }
      // LA SONDA DEL CAMINO REAL: el corte nocturno tiene que SELECCIONARLO. Si no, el arreglo del
      // repositorio no llegaria a correr nunca para este mensajero.
      const seleccionados = await new CorteDiarioRepository(
        tx as unknown as PrismaClient,
      ).findMensajerosConActividadSinCierre(diaQueElCorteCierra(new Date()));
      const cierreId = await crearCierre(tx, mensajeroId, "vencido");
      const cierre =
        cierreId === null
          ? null
          : await tx.cierreDia.findUniqueOrThrow({
              where: { id: cierreId },
              select: {
                estado: true,
                totalEfectivo: true,
                totalSimpe: true,
                totalTransferencia: true,
                totalGeneral: true,
                totalPagoMensajero: true,
                totalIngresoBodegaRechazos: true,
              },
            });
      return {
        ids: [...ids].sort(),
        seleccionado: seleccionados.some((s) => s.mensajeroId === mensajeroId),
        cierreId,
        estado: cierre?.estado ?? null,
        totales:
          cierre === null
            ? null
            : {
                efectivo: cierre.totalEfectivo.toFixed(2),
                simpe: cierre.totalSimpe.toFixed(2),
                transferencia: cierre.totalTransferencia.toFixed(2),
                general: cierre.totalGeneral.toFixed(2),
                pagoMensajero: cierre.totalPagoMensajero.toFixed(2),
                ingresoBodegaRechazos: cierre.totalIngresoBodegaRechazos.toFixed(2),
              },
        vinculos: await vinculosDelCierre(tx, cierreId),
        porGestion: await cierreIdPorGestion(tx, ids),
      };
    });

    expect(m.seleccionado).toBe(true);
    // Antes de la ficha: `null`, y la orden sin salida. Ahora: un cierre de REVISION.
    expect(m.cierreId).not.toBeNull();
    expect(m.estado).toBe("vencido");
    expect(m.vinculos).toEqual(m.ids);
    expect(Object.values(m.porGestion)).toEqual([null, null, null]);
    // Documento de revision, no de dinero: los seis totales en cero.
    expect(m.totales).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
      pagoMensajero: "0.00",
      ingresoBodegaRechazos: "0.00",
    });
  });

  it("R17: un mensajero SOLO con reprogramaciones de tienda sigue sin cierre y sin un solo vinculo (D2)", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const repro = await sembrarGestion(tx, mensajeroId, REPRO_TIENDA, "reprogramado");
      const cierreId = await crearCierre(tx, mensajeroId, "vencido");
      return {
        cierreId,
        cierres: await tx.cierreDia.count({ where: { mensajeroId } }),
        vinculos: await cierresQueVinculan(tx, repro.gestionId),
      };
    });

    expect(m.cierreId).toBeNull();
    expect(m.cierres).toBe(0);
    expect(m.vinculos).toEqual([]);
  });

  it("D2, primer cerrojo: una suelta con historial `rechazo_tienda` pero resultado `reprogramada` NO se incorpora", async () => {
    // FILA CRUZADA (ver cabecera): aisla el cerrojo `resultado: "rechazada"`.
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      await sembrarGestion(tx, mensajeroId, CALLE, "entregado");
      const cruzada = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "reprogramado");
      const cierreId = await crearCierre(tx, mensajeroId);
      return {
        cierreId,
        vinculos: await vinculosDelCierre(tx, cierreId),
        deLaCruzada: await cierresQueVinculan(tx, cruzada.gestionId),
      };
    });

    // El cierre existe por la calle: el `[]` de abajo no es verde por vacio.
    expect(m.cierreId).not.toBeNull();
    expect(m.vinculos).toEqual([]);
    expect(m.deLaCruzada).toEqual([]);
  });

  it("D2, segundo cerrojo: una suelta `rechazada` con historial `reprogramacion_tienda` NO se incorpora", async () => {
    // FILA CRUZADA (ver cabecera): aisla el cerrojo `historialEstados: { some: rechazo_tienda }`.
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      await sembrarGestion(tx, mensajeroId, CALLE, "entregado");
      const cruzada = await sembrarGestion(tx, mensajeroId, REPRO_TIENDA, "devolucion_a_origen_por_rechazo");
      const cierreId = await crearCierre(tx, mensajeroId);
      return {
        cierreId,
        vinculos: await vinculosDelCierre(tx, cierreId),
        deLaCruzada: await cierresQueVinculan(tx, cruzada.gestionId),
      };
    });

    expect(m.cierreId).not.toBeNull();
    expect(m.vinculos).toEqual([]);
    expect(m.deLaCruzada).toEqual([]);
  });

  it("R2/R15: el detalle lee lo CONGELADO, del rechazo mas viejo al mas reciente, aunque la orden cambie despues", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      // Se siembra PRIMERO el mas nuevo: el orden de insercion no puede ser lo que decide.
      const nuevo = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo", {
        remision: "NA-1103",
        createdAt: new Date("2026-09-10T18:00:00.000Z"),
        motivo: "El cliente no la quiere",
        numGuia: null,
      });
      const viejo = await sembrarGestion(tx, mensajeroId, RECHAZO_TIENDA, "devolucion_a_origen_por_rechazo", {
        remision: "NA-947",
        createdAt: new Date("2026-08-28T15:00:00.000Z"),
        motivo: null,
      });
      const cierreId = await crearCierre(tx, mensajeroId);
      if (cierreId === null) throw new Error("el cierre tenia que crearse");

      const leer = (id: string) =>
        tx.orden.findUniqueOrThrow({ where: { id }, select: { destinatario: true, producto: true } });
      const antes = { viejo: await leer(viejo.ordenId), nuevo: await leer(nuevo.ordenId) };
      const tienda = await tx.usuario.findUniqueOrThrow({
        where: { id: fks.tiendaId },
        select: { nombre: true },
      });
      const zona = await tx.zona.findUniqueOrThrow({
        where: { id: fks.zonaId },
        select: { nombre: true },
      });

      // La orden cambia DESPUES de incorporarse al cierre.
      await tx.orden.updateMany({
        where: { id: { in: [viejo.ordenId, nuevo.ordenId] } },
        data: { destinatario: "CAMBIADO DESPUES", producto: "CAMBIADO DESPUES" },
      });
      const detalle = await repoDe(tx).findCierrePropioConGestiones(cierreId, mensajeroId);
      return {
        viejo,
        nuevo,
        antes,
        tienda: tienda.nombre,
        zona: zona.nombre,
        rechazos: detalle?.rechazosDeTienda ?? null,
      };
    });

    expect(m.rechazos).toEqual([
      {
        gestionId: m.viejo.gestionId,
        ordenId: m.viejo.ordenId,
        numGuia: m.viejo.numGuia,
        numRemision: m.viejo.numRemision,
        destinatario: m.antes.viejo.destinatario,
        producto: m.antes.viejo.producto,
        tiendaNombre: m.tienda,
        zonaNombre: m.zona,
        rechazadoAt: "2026-08-28T15:00:00.000Z",
        motivo: null,
      },
      {
        gestionId: m.nuevo.gestionId,
        ordenId: m.nuevo.ordenId,
        numGuia: null,
        numRemision: m.nuevo.numRemision,
        destinatario: m.antes.nuevo.destinatario,
        producto: m.antes.nuevo.producto,
        tiendaNombre: m.tienda,
        zonaNombre: m.zona,
        rechazadoAt: "2026-09-10T18:00:00.000Z",
        motivo: "El cliente no la quiere",
      },
    ]);
    // Contrapunto: el dato VIVO si cambio; lo que se lee es la copia congelada.
    expect(m.antes.viejo.destinatario).not.toBe("CAMBIADO DESPUES");
  });
});
