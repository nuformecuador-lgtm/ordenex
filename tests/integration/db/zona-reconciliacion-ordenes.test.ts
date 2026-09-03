import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { GestionResultado, PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type { UpdateZonaData } from "@/lib/interfaces/repositories/IZonaRepository";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * ⭑ FICHA 366 / T5 — EL CORTE DE ELEGIBILIDAD, MEDIDO CONTRA POSTGRES REAL.
 *
 * POR QUE AQUI Y NO CON DOBLES. La elegibilidad de una orden NO es un `if` del repositorio: es un
 * `WHERE` con dos sub-consultas sobre OTRAS tablas (`cierre_detail` y `gestion_orden`), y los
 * tests de servicio usan dobles que NO VEN EL SQL. Este repo ya midio CUATRO veces que una
 * mutacion de un `where` sobrevive en verde por arriba. Cada exclusion de abajo tiene su caso que
 * la prueba EN VERDE (se reconcilia) y su caso que la prueba EN ROJO (no se reconcilia), que es lo
 * unico que hace que una mutacion del `where` se caiga.
 *
 * MUTACIONES PROBADAS A MANO DURANTE EL DESARROLLO (2026-09-03), cada una contra este archivo:
 *   · quitar `"incidente"` de la lista de `resultado`      -> rojo en «gestion `incidente`».
 *   · quitar el `resultado: { in: [...] }` entero          -> rojo en «`reprogramada` SI» y «`devuelta` SI».
 *   · quitar `anuladaAt: null`                             -> rojo en «gestion ANULADA SI».
 *   · quitar `cierreDetalles: { none: {} }`                -> rojo en «ya facturada».
 *   · `zonaId: { not: ... }` -> `zonaId: undefined`        -> rojo en «idempotencia».
 *   · la union de distritos -> solo `data.distritoIds`     -> rojo en «distrito recien quitado».
 *
 * ⚠️ NADA DE `if (!fks) return;`: con base y sin catalogo esto REVIENTA con un mensaje que dice
 * que hacer. Un test que no encuentra datos y se va por un `return` reporta `passed` sin haber
 * comprobado nada, y este repo ya se comio ese verde. Sin base alcanzable, `describe.skip` VISIBLE.
 * Todo ocurre dentro de una transaccion que SIEMPRE se revierte: la base local es compartida.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `366-${Date.now().toString(36)}`;
let contador = 0;
/** Sufijo unico por fila: `zona.nombre` es UNIQUE y `orden.num_remision` lo es por tienda. */
function unico(): string {
  contador += 1;
  return `${SUFIJO}-${contador.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** La forma que `update` espera. El nombre se repite tal cual para no chocar con el UNIQUE. */
function datosDeZona(nombre: string, distritoIds: string[]): UpdateZonaData {
  return { nombre, cobroVehiculo: false, esCentral: false, distritoIds, tarifas: [] };
}

interface Escenario {
  tx: TxDeTest;
  repo: ZonaRepository;
  /** Las tres zonas del escenario, con su nombre (que `update` tiene que reenviar igual). */
  zonas: { A: { id: string; nombre: string }; B: { id: string; nombre: string }; C: { id: string; nombre: string } };
  crearDistrito: (zonaIds: string[]) => Promise<string>;
  crearOrden: (opciones: {
    distritoId: string | null;
    zonaId: string;
    borrada?: boolean;
  }) => Promise<string>;
  crearGestion: (
    ordenId: string,
    resultado: GestionResultado,
    opciones?: { anulada?: boolean },
  ) => Promise<void>;
  crearDetalleDeCierre: (ordenId: string, zonaId: string) => Promise<string>;
  /** Las filas de historial de la reconciliacion que tocan a estas ordenes. */
  historialDe: (ordenIds: string[]) => Promise<
    { entidadId: string; loteId: string; valorAnterior: string | null; valorNuevo: string | null }[]
  >;
  zonaDe: (ordenId: string) => Promise<string>;
}

describeSiHayBase("⭑ 366/T5 — la reconciliacion de la zona de las ordenes, contra Postgres", () => {
  let prisma: PrismaClient;
  let FKS: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let USUARIO: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm run db:seed:zonas`) antes de esta suite.",
      );
    }
    FKS = fks;
    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    if (usuario === null) {
      throw new Error(
        "hacen falta usuarios en la base: la gestion y el cierre del dia cuelgan de uno. Corre " +
          "`pnpm run db:seed:maestro`.",
      );
    }
    USUARIO = usuario.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Siembra tres zonas vacias y entrega los constructores del escenario. Todo se revierte. */
  async function conEscenario<T>(fn: (e: Escenario) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const nombres = { A: `366 A ${unico()}`, B: `366 B ${unico()}`, C: `366 C ${unico()}` };
      const [a, b, c] = await Promise.all([
        tx.zona.create({ data: { nombre: nombres.A }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.B }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.C }, select: { id: true } }),
      ]);

      const escenario: Escenario = {
        tx,
        // `update` abre su propia `$transaction`; el pass-through la resuelve SOBRE ESTA MISMA tx,
        // asi que el SQL que se mide sigue siendo el real.
        repo: new ZonaRepository(clienteConTransaccionAnidada(tx)),
        zonas: {
          A: { id: a.id, nombre: nombres.A },
          B: { id: b.id, nombre: nombres.B },
          C: { id: c.id, nombre: nombres.C },
        },

        crearDistrito: async (zonaIds) => {
          const d = await tx.distrito.create({
            data: { nombre: `366 D ${unico()}`, cantonId: FKS.cantonId },
            select: { id: true },
          });
          for (const zonaId of zonaIds) {
            await tx.zonaDistrito.create({ data: { zonaId, distritoId: d.id } });
          }
          return d.id;
        },

        crearOrden: async ({ distritoId, zonaId, borrada = false }) => {
          const o = await tx.orden.create({
            data: {
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 366",
              telefonoDest: "8888-0000",
              producto: "caja de zapatos",
              estatusId: FKS.estatusId,
              tiendaId: FKS.tiendaId,
              zonaId,
              provinciaId: FKS.provinciaId,
              cantonId: FKS.cantonId,
              distritoId,
              direccion: "avenida siempre viva 742",
              montoCobrar: 12_000,
              intentosContacto: 2, // un valor DISTINGUIBLE: si algo lo tocara, se veria
              deletedAt: borrada ? new Date() : null,
            },
            select: { id: true },
          });
          return o.id;
        },

        // `mensajeroId` apunta a un usuario cualquiera: la FK es a `usuario` y este archivo mide el
        // `WHERE` sobre `gestion_orden`, no el rol de quien gestiono.
        crearGestion: async (ordenId, resultado, opciones = {}) => {
          await tx.gestionOrden.create({
            data: {
              ordenId,
              mensajeroId: USUARIO,
              resultado,
              ...(opciones.anulada === true ? { anuladaAt: new Date("2026-08-30T12:00:00Z") } : {}),
            },
            select: { id: true },
          });
        },

        crearDetalleDeCierre: async (ordenId, zonaId) => {
          const cierre = await tx.cierreDia.create({
            data: {
              mensajeroId: USUARIO,
              estado: "solicitado",
              destinoTipo: "bodega_central",
              destinoZonaId: zonaId,
            },
            select: { id: true },
          });
          const detalle = await tx.cierreDetail.create({
            data: {
              cierreId: cierre.id,
              ordenId,
              cobraComision: false,
              zonaId,
              tiendaId: FKS.tiendaId,
              esCentral: false,
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 366",
              producto: "caja de zapatos",
              tiendaNombre: "Tienda de prueba",
              zonaNombre: "Zona congelada",
              provinciaNombre: "Provincia",
              cantonNombre: "Canton",
            },
            select: { id: true },
          });
          return detalle.id;
        },

        historialDe: async (ordenIds) =>
          tx.historialAccion.findMany({
            where: { accion: "orden_zona_reconciliada", entidadId: { in: ordenIds } },
            select: { entidadId: true, loteId: true, valorAnterior: true, valorNuevo: true },
          }),

        zonaDe: async (ordenId) =>
          (
            await tx.orden.findUniqueOrThrow({ where: { id: ordenId }, select: { zonaId: true } })
          ).zonaId,
      };

      return fn(escenario);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // El caso base (R2/R4/R10) y las dos formas de no resolver una zona (R3)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R2/R4/R10: el distrito resuelve UNA zona -> la orden se re-estampa y deja su fila", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFinal: await e.zonaDe(orden),
        zonaA: e.zonas.A.id,
        historial: await e.historialDe([orden]),
        orden,
      };
    });

    expect(medido.reconciliadas).toBe(1);
    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.historial).toHaveLength(1);
    expect(medido.historial[0].entidadId).toBe(medido.orden);
    expect(medido.historial[0].loteId).toBeTruthy();
    // R10: la fila registra el HECHO. Ahi irian la zona vieja y la nueva, y no entran.
    expect(medido.historial[0].valorAnterior).toBeNull();
    expect(medido.historial[0].valorNuevo).toBeNull();
  });

  it("R3: un distrito que queda con CERO zonas no mueve ninguna orden", async () => {
    const medido = await conEscenario(async (e) => {
      // El distrito estaba SOLO en A y este guardado lo saca: se queda sin ninguna zona.
      const huerfano = await e.crearDistrito([e.zonas.A.id]);
      const queSigue = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: huerfano, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [queSigue]),
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFinal: await e.zonaDe(orden),
        zonaC: e.zonas.C.id,
        historial: await e.historialDe([orden]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaC);
    expect(medido.reconciliadas).toBe(0);
    expect(medido.historial).toEqual([]);
  });

  it("R3: un distrito que queda en DOS zonas a la vez es ambiguo -> no mueve ninguna orden", async () => {
    const medido = await conEscenario(async (e) => {
      // El esquema lo permite: `@@unique([zonaId, distritoId])`, no por `distritoId` solo.
      const ambiguo = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const orden = await e.crearOrden({ distritoId: ambiguo, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [ambiguo]),
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFinal: await e.zonaDe(orden),
        zonaC: e.zonas.C.id,
        historial: await e.historialDe([orden]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaC);
    expect(medido.reconciliadas).toBe(0);
    expect(medido.historial).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // El corte de elegibilidad (R6/R7/R8) — cada exclusion, con su contraparte incluida
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R6/R7/R8: una orden YA FACTURADA (con detalle de cierre) NO se reconcilia, y su detalle queda intacto", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const facturada = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const libre = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const detalleId = await e.crearDetalleDeCierre(facturada, e.zonas.B.id);
      const detalleAntes = await e.tx.cierreDetail.findUniqueOrThrow({ where: { id: detalleId } });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFacturada: await e.zonaDe(facturada),
        zonaLibre: await e.zonaDe(libre),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
        historialFacturada: await e.historialDe([facturada]),
        detalleAntes,
        detalleDespues: await e.tx.cierreDetail.findUniqueOrThrow({ where: { id: detalleId } }),
      };
    });

    // La facturada se queda quieta; la libre del MISMO distrito si se mueve (anti-vacuidad: sin
    // esto, un `where` que no encontrara nada dejaria el caso verde por la razon equivocada).
    expect(medido.zonaFacturada).toBe(medido.zonaB);
    expect(medido.zonaLibre).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
    // R7: y no deja rastro de una orden que no se toco.
    expect(medido.historialFacturada).toEqual([]);
    // R8: la fila del cierre, identica byte a byte.
    expect(medido.detalleDespues).toEqual(medido.detalleAntes);
  });

  const NO_ELEGIBLES: GestionResultado[] = ["entregada", "rechazada", "incidente"];
  it.each(NO_ELEGIBLES)(
    "⭑ R6/R7: una gestion VIGENTE con resultado `%s` deja la orden fuera",
    async (resultado) => {
      const medido = await conEscenario(async (e) => {
        const distrito = await e.crearDistrito([e.zonas.A.id]);
        const conGestion = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        const libre = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        await e.crearGestion(conGestion, resultado);

        const res = await e.repo.update(
          e.zonas.A.id,
          datosDeZona(e.zonas.A.nombre, [distrito]),
          USUARIO,
        );
        return {
          reconciliadas: res?.ordenesReconciliadas,
          zonaConGestion: await e.zonaDe(conGestion),
          zonaLibre: await e.zonaDe(libre),
          zonaA: e.zonas.A.id,
          zonaB: e.zonas.B.id,
          historial: await e.historialDe([conGestion]),
        };
      });

      expect(medido.zonaConGestion).toBe(medido.zonaB);
      expect(medido.zonaLibre).toBe(medido.zonaA); // anti-vacuidad
      expect(medido.reconciliadas).toBe(1);
      expect(medido.historial).toEqual([]);
    },
  );

  const SI_ELEGIBLES: GestionResultado[] = ["reprogramada", "devuelta"];
  it.each(SI_ELEGIBLES)(
    "⭑ R6: una gestion VIGENTE con resultado `%s` SI se reconcilia (el corte es por resultado)",
    async (resultado) => {
      // ESTE es el caso que distingue «excluir por resultado» de «excluir toda gestion vigente».
      // Las dos se rutean hacia adelante por `orden.zonaId` (liberacion de reprogramadas y SLA de
      // devoluciones): dejarlas con la zona vieja las mandaria a la bodega equivocada.
      const medido = await conEscenario(async (e) => {
        const distrito = await e.crearDistrito([e.zonas.A.id]);
        const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        await e.crearGestion(orden, resultado);

        const res = await e.repo.update(
          e.zonas.A.id,
          datosDeZona(e.zonas.A.nombre, [distrito]),
          USUARIO,
        );
        return {
          reconciliadas: res?.ordenesReconciliadas,
          zonaFinal: await e.zonaDe(orden),
          zonaA: e.zonas.A.id,
          historial: await e.historialDe([orden]),
        };
      });

      expect(medido.zonaFinal).toBe(medido.zonaA);
      expect(medido.reconciliadas).toBe(1);
      expect(medido.historial).toHaveLength(1);
    },
  );

  it("⭑ R6: una gestion ANULADA no excluye, aunque su resultado fuera `entregada`", async () => {
    // Prueba que la condicion filtra por `anulada_at IS NULL` y no por «tiene alguna gestion».
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      await e.crearGestion(orden, "entregada", { anulada: true });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFinal: await e.zonaDe(orden),
        zonaA: e.zonas.A.id,
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
  });

  it("R6: una orden BORRADA no se re-estampa", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const borrada = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        borrada: true,
      });
      const viva = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaBorrada: await e.zonaDe(borrada),
        zonaViva: await e.zonaDe(viva),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.zonaBorrada).toBe(medido.zonaB);
    expect(medido.zonaViva).toBe(medido.zonaA); // anti-vacuidad
    expect(medido.reconciliadas).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R5 — el alcance de distritos de cada guardado
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R5: volver a guardar la zona SIN cambiar sus distritos reconcilia la deriva ya existente", async () => {
    // Es el caso de produccion: `zona_distrito` ya apunta bien, pero la orden lleva la zona vieja
    // estampada desde una edicion anterior. El guardado se cura solo.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const derivada = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]), // MISMA lista de antes
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaFinal: await e.zonaDe(derivada),
        zonaA: e.zonas.A.id,
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
  });

  it("⭑ R5/R11: un distrito RECIEN QUITADO de esta zona se re-evalua en ESTE mismo guardado", async () => {
    // `quitado` estaba en A y en B; este guardado lo saca de A, asi que pasa a resolver B —y sus
    // ordenes se van a B sin necesidad de guardar B—. Es lo que distingue LA UNION de «solo la
    // lista final». De paso: las dos zonas resueltas de este guardado comparten `lote_id` (R11).
    const medido = await conEscenario(async (e) => {
      const quitado = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const queSigue = await e.crearDistrito([e.zonas.A.id]);
      const ordenQuitado = await e.crearOrden({ distritoId: quitado, zonaId: e.zonas.A.id });
      const ordenQueSigue = await e.crearOrden({ distritoId: queSigue, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [queSigue]), // sin `quitado`
        USUARIO,
      );
      return {
        reconciliadas: res?.ordenesReconciliadas,
        zonaDelQuitado: await e.zonaDe(ordenQuitado),
        zonaDelQueSigue: await e.zonaDe(ordenQueSigue),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
        historial: await e.historialDe([ordenQuitado, ordenQueSigue]),
      };
    });

    expect(medido.zonaDelQuitado).toBe(medido.zonaB);
    expect(medido.zonaDelQueSigue).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(2);
    // R11: DOS zonas resueltas distintas, UN solo lote.
    expect(medido.historial).toHaveLength(2);
    expect(new Set(medido.historial.map((f) => f.loteId)).size).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R9, R13 y R14
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R9: de la orden reconciliada cambia `zonaId` (y `updatedAt`), y NADA MAS", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const antes = await e.tx.orden.findUniqueOrThrow({ where: { id: orden } });

      await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, [distrito]), USUARIO);

      return {
        antes,
        despues: await e.tx.orden.findUniqueOrThrow({ where: { id: orden } }),
        zonaA: e.zonas.A.id,
      };
    });

    // La fila ENTERA comparada, no una lista de columnas que uno recuerde: lo que esta ficha
    // promete es una AUSENCIA, y solo se demuestra mirandolo todo.
    const cambiadas = Object.keys(medido.antes).filter(
      (k) =>
        JSON.stringify((medido.antes as Record<string, unknown>)[k]) !==
        JSON.stringify((medido.despues as Record<string, unknown>)[k]),
    );
    expect(cambiadas.sort()).toEqual(["updatedAt", "zonaId"]);
    expect((medido.despues as unknown as { zonaId: string }).zonaId).toBe(medido.zonaA);
  });

  it("⭑ R13: `create()` de una zona nueva no reconcilia ninguna orden", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      const conDeriva = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.A.id });

      await e.repo.create({
        nombre: `366 NUEVA ${unico()}`,
        cobroVehiculo: false,
        esCentral: false,
        distritoIds: [distrito],
        tarifas: [],
      });

      return {
        zonaFinal: await e.zonaDe(conDeriva),
        zonaA: e.zonas.A.id,
        historial: await e.historialDe([conDeriva]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.historial).toEqual([]);
  });

  it("⭑ R14: repetir el mismo guardado informa 0 y no añade ni una fila de historial", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const datos = datosDeZona(e.zonas.A.nombre, [distrito]);

      const primera = await e.repo.update(e.zonas.A.id, datos, USUARIO);
      const historialTrasPrimera = await e.historialDe([orden]);
      const segunda = await e.repo.update(e.zonas.A.id, datos, USUARIO);

      return {
        primera: primera?.ordenesReconciliadas,
        segunda: segunda?.ordenesReconciliadas,
        historialTrasPrimera: historialTrasPrimera.length,
        historialTrasSegunda: (await e.historialDe([orden])).length,
      };
    });

    expect(medido.primera).toBe(1);
    expect(medido.segunda).toBe(0);
    expect(medido.historialTrasPrimera).toBe(1);
    expect(medido.historialTrasSegunda).toBe(1);
  });
});
