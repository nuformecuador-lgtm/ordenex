import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { DeshacerAsignacionService } from "@/lib/services/DeshacerAsignacionService";
import { MSG_DESTINO_NO_DECLARADO } from "@/lib/services/mensajes-deshacer-asignacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑⭑ FICHA 363 — DESHACER EL RUTEO DE UNA ORDEN DE ZONA SATELITE.
 *
 * EL DEFECTO, MEDIDO EN PRODUCCION: «no puedo deshacer las asignaciones de Guanacaste, me sale un
 * error con la zona». 17 guias reportadas (13375561, 22612680, 23225358, 25354990, 29298684,
 * 32241041, 34250134, 35207046, 38166241, 39553560, 50310199, 53061607, 58577166, 63319645,
 * 66061052, 72379753, 89612539) y las 94 ordenes vivas de `FGAM Guanacaste (Tempisque)`: TODAS el
 * mismo caso —estado `en_ruta_bodega_satelite`, venidas de `en_bodega_central` por
 * `ruteo_satelite`—. `DeshacerAsignacionService` verificaba el destino inferido contra la ZONA de
 * la orden y lo llamaba incoherente. La premisa era falsa: la zona dice a que bodega PERTENECE la
 * orden, NO donde esta el paquete. Afectaba a CUALQUIER zona satelite, porque es el flujo normal.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES. Lo que hay que demostrar es que la orden TERMINA en
 * `en_bodega_central` en la fila real, atravesando el `UPDATE ... WHERE "estatus_id" = origen` de
 * `deshacerAsignacionLote` y la guardia de transiciones de la 140 dentro de la misma transaccion.
 * Con dobles, `deshacerAsignacionLote` es un `vi.fn()`: una mutacion del `WHERE` pasa en verde
 * —medido cuatro veces en este repo— y el estado final lo afirmaria el propio test.
 *
 * LAS TRES MITADES, Y POR QUE HACEN FALTA LAS TRES:
 *   1. el caso de las 17 guias -> AHORA SE DESHACE;
 *   2. el simetrico, que prueba que no se abrio de mas: deshacer una orden EN CAMINO a la
 *      satelite no puede dejarla marcada como RECIBIDA alli -> SIGUE RECHAZADO, y sin escribir;
 *   3. la otra mitad de la condicion retirada (destino satelite + zona central), que esta MEDIDA
 *      como legitima y por eso pasa a `ok`.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. Sin base se SALTA ENTERO y con su
 * nombre en el reporte; con base y sin datos REVIENTA con instrucciones, no retorna.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `363-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 40_000_000);

const MAESTRO_ROL = "maestro" as const;
const MOTIVO = "la satelite no puede recibir hoy: el lote vuelve a la bodega central";

/** Los cuatro `value` del catalogo que esta suite necesita. */
const VALUES = [
  "por_recoger",
  "en_ruta_bodega_satelite",
  "en_bodega_central",
  "en_bodega_satelite",
] as const;
type ValueNecesario = (typeof VALUES)[number];

interface Semilla {
  /** Estado en el que nace la orden (y destino de su fila de historial). */
  estadoActual: ValueNecesario;
  /** `value` del estado de ORIGEN de esa fila: de aqui sale la inferencia del destino. */
  origenHistorial: ValueNecesario;
  /** `true` = zona con `es_central`; `false` = zona satelite REAL de la base. */
  enZonaCentral: boolean;
}

interface Resultado {
  status: string;
  detalle?: { ordenId: string; motivo: string }[];
  /** `value` del estado de la orden RELEIDO de la fila, despues de llamar al service. */
  estadoFinal: string;
  /** Filas de historial de esa orden cuyo `origen_tipo` es `deshacer_asignacion`. */
  filasDeshacer: { origen: string | null; destino: string; motivo: string | null }[];
}

describeSiHayBase("363 — deshacer el ruteo a una bodega satelite, contra Postgres real", () => {
  let prisma: PrismaClient;
  let ejecutar: (semilla: Semilla) => Promise<Resultado>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm exec tsx scripts/seed-zonas.ts`) antes de esta suite.",
      );
    }

    // Las DOS zonas REALES de la base, no inventadas: el defecto vivia en la comparacion entre
    // la zona de la orden y la central, asi que la satelite tiene que ser una satelite de verdad.
    const central = await prisma.zona.findFirst({
      where: { esCentral: true },
      select: { id: true, nombre: true },
    });
    const satelite = await prisma.zona.findFirst({
      where: { esCentral: false },
      select: { id: true, nombre: true },
    });
    if (central === null || satelite === null) {
      throw new Error(
        `la tabla \`zona\` no tiene una central (es_central) y una satelite a la vez ` +
          `(central=${central?.nombre ?? "AUSENTE"}, satelite=${satelite?.nombre ?? "AUSENTE"}): ` +
          "sin las dos no hay nada que medir. Corre `pnpm exec tsx scripts/seed-zonas.ts`.",
      );
    }

    const filas = await prisma.orderStatus.findMany({
      where: { value: { in: [...VALUES] } },
      select: { id: true, value: true },
    });
    const idPorValue = new Map(filas.map((f) => [f.value, f.id]));
    const faltantes = VALUES.filter((v) => !idPorValue.has(v));
    if (faltantes.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltantes.join(", ")}: sin esos estados no hay ` +
          "reversion que medir. Corre el seed del catalogo.",
      );
    }
    const idDe = (v: ValueNecesario): string => idPorValue.get(v) as string;
    const valueDe = (id: string): string =>
      filas.find((f) => f.id === id)?.value ?? `id-desconocido:${id}`;

    // `orden.tienda_id` es FK -> `usuario` (la tienda ES un usuario), asi que el mismo id sirve
    // de actor del historial. Lo que se mide aqui es una SENTENCIA, no un rol.
    const actor: Actor = { usuarioId: fks.tiendaId, rol: MAESTRO_ROL };
    let n = 0;

    ejecutar = (semilla) =>
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        n += 1;
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + n,
            numRemision: `R-${SUFIJO}-${n}`,
            destinatario: "Corpus 363",
            telefonoDest: "88880000",
            producto: "caja",
            estatusId: idDe(semilla.estadoActual),
            tiendaId: fks.tiendaId,
            zonaId: semilla.enZonaCentral ? central.id : satelite.id,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
          },
          select: { id: true },
        });

        // LA FILA DE LA QUE SALE LA INFERENCIA (R11): la transicion que se esta deshaciendo.
        // `origen_tipo` = `ruteo_satelite` para el caso (b), que es literalmente el de las 17
        // guias; el service no lo lee (lee el par origen/destino), pero escribirlo distinto
        // seria sembrar una historia que la aplicacion no produce.
        await tx.ordenHistorialEstado.create({
          data: {
            ordenId: orden.id,
            estatusOrigenId: idDe(semilla.origenHistorial),
            estatusDestinoId: idDe(semilla.estadoActual),
            actorUsuarioId: actor.usuarioId,
            origenTipo:
              semilla.estadoActual === "en_ruta_bodega_satelite"
                ? "ruteo_satelite"
                : "asignacion_satelite",
          },
        });

        // El service REAL con los repositorios REALES sobre la transaccion del test.
        // `clienteConTransaccionAnidada` existe porque `deshacerAsignacionLote` abre su propia
        // `$transaction`, que el cliente de tx de Prisma no expone.
        const cliente = clienteConTransaccionAnidada(tx);
        const service = new DeshacerAsignacionService(
          new OrdenRepository(cliente),
          new OrdenHistorialRepository(cliente),
        );

        const r = await service.deshacer({ ordenIds: [orden.id], motivo: MOTIVO }, actor);

        const fila = await tx.orden.findUniqueOrThrow({
          where: { id: orden.id },
          select: { estatusId: true, mensajeroAsignadoId: true, asignadoAt: true },
        });
        const historial = await tx.ordenHistorialEstado.findMany({
          where: { ordenId: orden.id, origenTipo: "deshacer_asignacion" },
          select: { estatusOrigenId: true, estatusDestinoId: true, motivo: true },
        });

        return {
          status: r.status,
          detalle: r.status === "conflict" ? r.detalle : undefined,
          estadoFinal: valueDe(fila.estatusId),
          filasDeshacer: historial.map((h) => ({
            origen: h.estatusOrigenId === null ? null : valueDe(h.estatusOrigenId),
            destino: valueDe(h.estatusDestinoId),
            motivo: h.motivo,
          })),
        } satisfies Resultado;
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /* ---------------------------------------------------------------------------------- */
  /* 1 — EL CASO DE LAS 17 GUIAS                                                          */
  /* ---------------------------------------------------------------------------------- */

  it("⭑ orden de zona SATELITE en `en_ruta_bodega_satelite` que vino de la central: se deshace", async () => {
    // ESTA es la asercion que estaba roja en produccion: antes de la 363 devolvia `conflict` con
    // «el destino derivado no corresponde a la zona de la orden» y la fila no se movia.
    const r = await ejecutar({
      estadoActual: "en_ruta_bodega_satelite",
      origenHistorial: "en_bodega_central",
      enZonaCentral: false,
    });

    expect(r.status).toBe("ok");
    expect(r.estadoFinal).toBe("en_bodega_central"); // la FILA, releida de Postgres
  });

  it("y deja EXACTAMENTE una fila de historial `deshacer_asignacion`, con el motivo del lote", async () => {
    // La otra mitad del caso 1: un `SET` que moviera el estado sin dejar rastro tambien pondria
    // verde la asercion de arriba, y seria otro defecto.
    const r = await ejecutar({
      estadoActual: "en_ruta_bodega_satelite",
      origenHistorial: "en_bodega_central",
      enZonaCentral: false,
    });

    expect(r.filasDeshacer).toEqual([
      { origen: "en_ruta_bodega_satelite", destino: "en_bodega_central", motivo: MOTIVO },
    ]);
  });

  /* ---------------------------------------------------------------------------------- */
  /* 2 — EL SIMETRICO: LO QUE LA GUARDA DEBIA IMPEDIR, Y SIGUE IMPEDIDO                   */
  /* ---------------------------------------------------------------------------------- */

  it("⭑ deshacer una orden EN CAMINO a la satelite NO puede dejarla como RECIBIDA en la satelite", async () => {
    // LA SITUACION, CON NOMBRE. Una orden en `en_ruta_bodega_satelite` cuya fila de historial
    // dice que venia de `en_bodega_satelite`: la normalizacion (D3', identidad para ese origen)
    // inferiria destino `en_bodega_satelite`, o sea «la satelite la recibio». NADIE LA RECIBIO —
    // el paquete va en la furgoneta—. Escribir ese estado falsificaria la custodia del paquete
    // y ademas lo sacaria del listado de la central sin meterlo en el de nadie.
    //
    // Y NO LO CAZA NADIE MAS AGUAS ABAJO: `assertTransicionValida` (guardia de la 140) ignora la
    // FAMILIA a proposito, y la arista `en_ruta_bodega_satelite -> en_bodega_satelite` EXISTE
    // (#10, la recepcion satelite del `adminSatelite`). Sin la verificacion del service esto se
    // escribiria en silencio, con el historial diciendo `deshacer_asignacion`.
    const r = await ejecutar({
      estadoActual: "en_ruta_bodega_satelite",
      origenHistorial: "en_bodega_satelite",
      enZonaCentral: false,
    });

    expect(r.status).toBe("conflict");
    expect(r.detalle?.map((d) => d.motivo)).toEqual([MSG_DESTINO_NO_DECLARADO]);
    // Y CERO EFECTOS en la base: ni el estado ni el historial se movieron (R20).
    expect(r.estadoFinal).toBe("en_ruta_bodega_satelite");
    expect(r.filasDeshacer).toEqual([]);
  });

  /* ---------------------------------------------------------------------------------- */
  /* 3 — LA OTRA MITAD DE LA CONDICION RETIRADA, MEDIDA                                   */
  /* ---------------------------------------------------------------------------------- */

  it("orden de zona CENTRAL cuyo paquete quedo en la satelite: vuelve a la SATELITE", async () => {
    // `destino === "en_bodega_satelite" && zona central` era la otra mitad de la condicion vieja.
    // Se midio antes de retirarla: `ESTADOS_SIN_CORRECCION` (lib/types/correccion-datos-cliente.ts)
    // son los tres terminales mas `rechazada`, de modo que la ficha 327 SI permite corregir el
    // distrito de una orden en `por_recoger`, y su R5/R15 REESCRIBEN la zona derivada. Una orden
    // recibida en la satelite (#10) y asignada alli (#9) a la que despues se le corrige la
    // direccion a un distrito del GAM queda con zona central y el paquete FISICAMENTE en la
    // bodega satelite. Ahi el destino correcto es la satelite; rechazarlo dejaba la orden sin
    // ninguna via de deshacer.
    const r = await ejecutar({
      estadoActual: "por_recoger",
      origenHistorial: "en_bodega_satelite",
      enZonaCentral: true,
    });

    expect(r.status).toBe("ok");
    expect(r.estadoFinal).toBe("en_bodega_satelite");
  });

  /* ---------------------------------------------------------------------------------- */
  /* 4 — LA ZONA NO DECIDE NADA (el nucleo de la 363)                                     */
  /* ---------------------------------------------------------------------------------- */

  it.each([
    ["central", true],
    ["satelite", false],
  ])(
    "misma orden en zona %s y mismo historial: el destino es el mismo (lo fija el historial)",
    async (_nombre, enZonaCentral) => {
      const r = await ejecutar({
        estadoActual: "por_recoger",
        origenHistorial: "en_bodega_central",
        enZonaCentral,
      });

      expect(r.status).toBe("ok");
      expect(r.estadoFinal).toBe("en_bodega_central");
    },
  );
});
