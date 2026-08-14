import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type {
  FilaRollup,
  MedidasReconciliables,
} from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";
import { ventanaDelDia } from "@/lib/analytics/rollup-dia";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import {
  FECHA_D,
  FECHA_D_MAS_1,
  FECHA_D_MENOS_1,
  agregarTransicion,
  claveOrden,
  crearCierreAprobado,
  crearGestion,
  crearOrden,
  crearRepositorio,
  crearServicio,
  estatusId,
  instanteCR,
  leerFilas,
  resumen,
  sembrarBase,
  type BaseSembrada,
  type FilaLeida,
  type TxDeTest,
} from "./_semilla-rollup";

/**
 * Feature 124 / T6 — la suite de INTEGRACION del job de agregacion diaria contra el Postgres
 * local (`localhost:5432/ordenex`). Cubre R1, R7, R10-R20, R22-R31, R34, R35, R45, R46 y R49.
 *
 * Por que contra base y no con dobles: lo que se mide aqui es el SQL. Los casos de la 123 que
 * hasta hoy solo verificaba una regex sobre el texto de la migracion —la cota estricta del
 * corte, el desempate por `id`, la ultima transicion y no la primera, `deleted_at`,
 * `anulada_at`, la zona de la ORDEN— pasan a ser medidas sobre datos sembrados: mutar
 * cualquiera de esas seis cosas pone rojo un caso de este archivo, no un guardia de texto.
 *
 * AISLAMIENTO (ver `_semilla-rollup.ts`): la fecha objetivo vive en 2001, donde la base de
 * desarrollo no tiene ni una transicion de historial, y todo corre en una transaccion que
 * SIEMPRE se revierte. El primer caso comprueba el aislamiento: si fallara, ningun conteo de
 * los de abajo afirmaria nada.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Coordenadas + medidas de una fila, sin el ruido de los uuids ni de los ceros. */
type Resumen = ReturnType<typeof resumen>;

describeSiHayBase("job de agregacion diaria contra Postgres (feature 124)", () => {
  let prisma: PrismaClient;

  /** Un caso: siembra la base, corre lo que pida el test y REVIERTE. */
  function conBase<T>(fn: (tx: TxDeTest, base: BaseSembrada) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => fn(tx, await sembrarBase(tx)));
  }

  /** Ejecuta una corrida REAL del servicio sobre una fecha. */
  async function correr(tx: TxDeTest, fecha: string) {
    return crearServicio(tx).agregarFecha(fecha);
  }

  async function resumenes(tx: TxDeTest, base: BaseSembrada, fecha: string): Promise<Resumen[]> {
    return (await leerFilas(tx, base, fecha)).map(resumen);
  }

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ---------------------------------------------------------------- T6.2 calendario

  describe("calendario (T6.2)", () => {
    it("el dia sin ordenes escribe CERO filas y no falla (R46), lo que ademas prueba el aislamiento", async () => {
      await conBase(async (tx, base) => {
        const r = await correr(tx, FECHA_D);
        expect(r).toMatchObject({ fecha: FECHA_D, filasEscritas: 0, filasRetiradas: 0 });
        expect(typeof r.ms).toBe("number");
        // Contrapeso de TODO el archivo: si la base de desarrollo se colara en la ventana
        // sembrada, aqui habria filas y ningun conteo posterior seria afirmable.
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });

    it("la pareja de medianoche: 23:59:59 CR cae en D y 00:00:00 CR cae en D+1 (R7)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "23:59:59");
        const x = await crearOrden(tx, base, {
          clave: "x-2359",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, x, { at: nacida, destino: "pendiente" });

        const yaEsManana = instanteCR(FECHA_D_MAS_1, "00:00:00");
        const y = await crearOrden(tx, base, {
          clave: "y-0000",
          zonaId: base.zonaA,
          tiendaId: base.tienda2,
          createdAt: yaEsManana,
        });
        await agregarTransicion(tx, base, y, { at: yaEsManana, destino: "pendiente" });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);

        await correr(tx, FECHA_D_MAS_1);
        expect(await resumenes(tx, base, FECHA_D_MAS_1)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "pendiente",
            causa: null,
            ordenesEstadoStock: 1, // la de las 23:59:59 sigue viva, pero NO nacio este dia
          },
          {
            zona: "zonaA",
            tienda: "tienda2",
            mensajero: null,
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);
      });
    });

    it("la transicion del corte (00:00:00 CR del dia siguiente) NO entra en el cierre de D (R24, cota estricta)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "10:00:00");
        const o = await crearOrden(tx, base, {
          clave: "corte",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        // El corte diario escribe esta transicion EXACTAMENTE en el instante del corte de D.
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D_MAS_1, "00:00:00"),
          destino: "sin_gestionar",
          origenTipo: "corte_sin_gestionar",
        });

        await correr(tx, FECHA_D);
        const filas = await leerFilas(tx, base, FECHA_D);
        expect(filas).toHaveLength(1);
        // Con `<=` en vez de `<` esto seria "sin_gestionar" y el embudo se moveria un dia.
        expect(filas[0].estatus).toBe("pendiente");
      });
    });

    it("la corrida de D no crea ni modifica filas de D-1 ni de D+1 (R35)", async () => {
      await conBase(async (tx, base) => {
        for (const [fecha, zona, tienda] of [
          [FECHA_D_MENOS_1, base.zonaA, base.tienda1],
          [FECHA_D, base.zonaA, base.tienda2],
          [FECHA_D_MAS_1, base.zonaB, base.tienda1],
        ] as const) {
          const nacida = instanteCR(fecha, "09:00:00");
          const o = await crearOrden(tx, base, {
            clave: `vecina-${fecha}`,
            zonaId: zona,
            tiendaId: tienda,
            createdAt: nacida,
          });
          await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        }

        await correr(tx, FECHA_D_MENOS_1);
        await correr(tx, FECHA_D_MAS_1);
        const antesMenos = await leerFilas(tx, base, FECHA_D_MENOS_1);
        const antesMas = await leerFilas(tx, base, FECHA_D_MAS_1);
        expect(antesMenos.length).toBeGreaterThan(0);
        expect(antesMas.length).toBeGreaterThan(0);

        await correr(tx, FECHA_D);

        // Comparacion de `updated_at` ANTES y DESPUES: una ventana de dos dias los tocaria.
        expect(await leerFilas(tx, base, FECHA_D_MENOS_1)).toEqual(antesMenos);
        expect(await leerFilas(tx, base, FECHA_D_MAS_1)).toEqual(antesMas);
        expect((await leerFilas(tx, base, FECHA_D)).length).toBeGreaterThan(0);
      });
    });
  });

  // ---------------------------------------------------------------- T6.3 coordenadas

  describe("coordenadas (T6.3)", () => {
    it("la orden sin mensajero escribe el cubo con mensajero_id NULL, nunca un centinela (R25)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "sin-mensajero",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: null,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });

        await correr(tx, FECHA_D);
        const crudas = await tx.$queryRaw<{ mensajero_id: string | null; n: bigint }[]>`
          SELECT "mensajero_id", COUNT(*) AS n FROM "analytics_daily"
          WHERE "fecha" = ${FECHA_D}::date GROUP BY 1`;
        expect(crudas).toEqual([{ mensajero_id: null, n: BigInt(1) }]);
      });
    });

    it("la orden de la zona A gestionada por un mensajero de la zona B escribe la zona A (R22)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "zona-cruzada",
          zonaId: base.zonaA, // la ORDEN es de la zona A
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1, // el MENSAJERO es de la zona B
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        const entrega = instanteCR(FECHA_D, "12:00:00");
        const g = await crearGestion(tx, {
          ordenId: o,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: entrega,
        });
        await agregarTransicion(tx, base, o, {
          at: entrega,
          destino: "entregada",
          origenTipo: "gestion",
          gestionOrdenId: g,
        });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA", // con la zona del USUARIO esto seria "zonaB"
            tienda: "tienda1",
            mensajero: "mensajero1",
            estatus: "entregada",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1, // cerro DENTRO del dia (D2-B2 rama b)
            entregas: 1,
            primerIntentoOk: 1,
            segCicloAcum: 4 * 3600,
            segCicloN: 1,
          },
        ]);
      });
    });

    it("la orden desasignada despues de gestionar produce DOS filas, una por familia de medida (R23)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "desasignada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: null, // ya desasignada en el momento de la corrida
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        const gestionada = instanteCR(FECHA_D, "12:00:00");
        const g = await crearGestion(tx, {
          ordenId: o,
          mensajeroId: base.mensajero1,
          resultado: "reprogramada",
          at: gestionada,
        });
        await agregarTransicion(tx, base, o, {
          at: gestionada,
          destino: "reprogramada",
          origenTipo: "gestion",
          gestionOrdenId: g,
        });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null, // medidas de ORDEN: `orden.mensajero_asignado_id`
            estatus: "reprogramada",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: "mensajero1", // medidas de GESTION: `gestion_orden.mensajero_id`
            estatus: "reprogramada",
            causa: null,
            reprogramaciones: 1,
          },
        ]);
      });
    });

    it("el estatus HUERFANO del catalogo no descarta la orden ni hace fallar la corrida (R45)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "huerfano",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        // `en_fulfillment` existe en `order_status` pero NO en `ORDER_STATUS_SEED`.
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "09:00:00"),
          destino: "en_fulfillment",
        });

        const r = await correr(tx, FECHA_D);
        expect(r.filasEscritas).toBe(1);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "en_fulfillment",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);
      });
    });

    it("la orden BORRADA queda fuera de TODAS las medidas, tambien de sus gestiones (D7/R10/R13)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const borrada = await crearOrden(tx, base, {
          clave: "borrada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: nacida,
          deletedAt: instanteCR(FECHA_D, "23:00:00"),
        });
        await agregarTransicion(tx, base, borrada, { at: nacida, destino: "pendiente" });
        await crearGestion(tx, {
          ordenId: borrada,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "12:00:00"),
        });

        // Control vivo, para que el caso no pase por "no hay nada que contar".
        const viva = await crearOrden(tx, base, {
          clave: "viva",
          zonaId: base.zonaA,
          tiendaId: base.tienda2,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, viva, { at: nacida, destino: "pendiente" });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda2",
            mensajero: null,
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);
      });
    });
  });

  // ---------------------------------------------------------------- T6.4 medidas

  describe("medidas (T6.4)", () => {
    it("dos cambios de estatus el mismo dia: 1 al estatus de CIERRE y 0 a los intermedios (R12)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "dos-cambios",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "12:00:00"),
          destino: "en_reparto",
        });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "20:00:00"),
          destino: "reprogramada",
        });

        await correr(tx, FECHA_D);
        const filas = await leerFilas(tx, base, FECHA_D);
        // Con la PRIMERA transicion del dia en vez de la ultima, esto seria "pendiente".
        expect(filas.map((f) => f.estatus)).toEqual(["reprogramada"]);
        expect(filas[0].ordenesEstadoStock).toBe(1);
      });
    });

    it("dos transiciones con el MISMO created_at se desempatan de forma determinista (R12/R27)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "empate",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        const empate = instanteCR(FECHA_D, "12:00:00");
        // Se inserta PRIMERO la del id menor: sin el desempate `id DESC`, el `DISTINCT ON`
        // se queda con la que el motor lee antes (la insertada primero) y gana "en_reparto".
        await agregarTransicion(tx, base, o, {
          at: empate,
          destino: "en_reparto",
          id: "00000000-0000-4000-8000-000000000001",
        });
        await agregarTransicion(tx, base, o, {
          at: empate,
          destino: "reprogramada",
          id: "ffffffff-0000-4000-8000-000000000002",
        });

        await correr(tx, FECHA_D);
        const primera = await leerFilas(tx, base, FECHA_D);
        await correr(tx, FECHA_D);
        const segunda = await leerFilas(tx, base, FECHA_D);

        expect(primera.map((f) => f.estatus)).toEqual(["reprogramada"]);
        expect(segunda.map((f) => f.estatus)).toEqual(primera.map((f) => f.estatus));
      });
    });

    it("la orden entregada hace TRES dias no esta en el stock de hoy; la que cerro hoy SI (R11/D2-B2)", async () => {
      await conBase(async (tx, base) => {
        // (a) cerro hace tres dias: sigue viva y no borrada, pero su estatus al corte es
        // terminal y NO cerro dentro de la ventana -> fuera del embudo del dia.
        const vieja = await crearOrden(tx, base, {
          clave: "vieja-entregada",
          zonaId: base.zonaA,
          tiendaId: base.tienda2,
          createdAt: instanteCR("2001-06-05", "09:00:00"),
        });
        await agregarTransicion(tx, base, vieja, {
          at: instanteCR("2001-06-05", "09:00:00"),
          destino: "pendiente",
        });
        await agregarTransicion(tx, base, vieja, {
          at: instanteCR("2001-06-12", "12:00:00"),
          destino: "entregada",
        });

        // (b) cierra HOY: aparece en el estatus en que cerro.
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const hoy = await crearOrden(tx, base, {
          clave: "cierra-hoy",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, hoy, { at: nacida, destino: "pendiente" });
        await agregarTransicion(tx, base, hoy, {
          at: instanteCR(FECHA_D, "18:00:00"),
          destino: "entregada",
        });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "entregada",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
            segCicloAcum: 10 * 3600,
            segCicloN: 1,
          },
        ]);
      });
    });

    it("la gestion ANULADA no cuenta en ninguna medida de gestion (R14)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "anulada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        await crearGestion(tx, {
          ordenId: o,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "12:00:00"),
          anuladaAt: instanteCR(FECHA_D, "20:00:00"),
        });

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: "mensajero1",
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);
      });
    });

    it("la causa de devolucion solo se informa en las filas de `devuelta`, y sin causa queda NULL (R15/R16)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const sembrarConGestion = async (
          clave: string,
          resultado: "entregada" | "devuelta",
          causa: "not_found" | null,
        ): Promise<void> => {
          const o = await crearOrden(tx, base, {
            clave,
            zonaId: base.zonaA,
            tiendaId: base.tienda1,
            mensajeroId: base.mensajero1,
            createdAt: nacida,
          });
          await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
          await crearGestion(tx, {
            ordenId: o,
            mensajeroId: base.mensajero1,
            resultado,
            at: instanteCR(FECHA_D, "12:00:00"),
            causaDevolucion: causa,
          });
        };
        await sembrarConGestion("entregada", "entregada", null);
        await sembrarConGestion("devuelta-con-causa", "devuelta", "not_found");
        await sembrarConGestion("devuelta-sin-causa", "devuelta", null);

        await correr(tx, FECHA_D);
        const filas = await leerFilas(tx, base, FECHA_D);
        expect(filas.map(resumen)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: "mensajero1",
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 3,
            ordenesEstadoStock: 3,
            entregas: 1,
            devoluciones: 1, // la devolucion SIN causa: NULL, nunca un valor inventado
            primerIntentoOk: 1,
          },
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: "mensajero1",
            estatus: "pendiente",
            causa: "not_found",
            devoluciones: 1,
          },
        ]);
        // R15 dicho al reves: ninguna fila con causa cuenta algo que no sea una devolucion.
        for (const f of filas.filter((x) => x.causa !== null)) {
          expect([f.entregas, f.rechazos, f.reprogramaciones, f.incidentes]).toEqual([0, 0, 0, 0]);
          expect([f.ordenesCreadas, f.ordenesEstadoStock, f.primerIntentoOk]).toEqual([0, 0, 0]);
        }
      });
    });

    it("primer intento vs entrega tras una devolucion previa (R17)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const limpia = await crearOrden(tx, base, {
          clave: "primer-intento",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, limpia, { at: nacida, destino: "pendiente" });
        await crearGestion(tx, {
          ordenId: limpia,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "12:00:00"),
        });

        // La segunda ya acumulaba un intento VIGENTE (feature 215: una gestion `devuelta` no
        // anulada, nacida de una visita real y perteneciente a un cierre APROBADO), asi que su
        // entrega de hoy NO es primer intento.
        const reintentada = await crearOrden(tx, base, {
          clave: "tras-devolucion",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: instanteCR("2001-06-13", "09:00:00"),
        });
        await agregarTransicion(tx, base, reintentada, {
          at: instanteCR("2001-06-13", "09:00:00"),
          destino: "pendiente",
        });
        const cierreAprobado = await crearCierreAprobado(tx, {
          mensajeroId: base.mensajero1,
          zonaId: base.zonaB, // `mensajero1` es de la zona B (ver `sembrarBase`)
          at: instanteCR("2001-06-13", "18:00:00"),
        });
        const devolucion = await crearGestion(tx, {
          ordenId: reintentada,
          mensajeroId: base.mensajero1,
          resultado: "devuelta",
          at: instanteCR("2001-06-13", "13:00:00"),
          cierreId: cierreAprobado,
        });
        await agregarTransicion(tx, base, reintentada, {
          at: instanteCR("2001-06-13", "13:00:00"),
          destino: "devuelta",
          origenTipo: "gestion",
          gestionOrdenId: devolucion,
        });
        await crearGestion(tx, {
          ordenId: reintentada,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "12:00:00"),
        });

        await correr(tx, FECHA_D);
        const filas = await leerFilas(tx, base, FECHA_D);
        // Las dos entregas son del mismo mensajero y del mismo dia: lo unico que separa sus
        // cubos es el estatus al corte, y lo unico que las distingue es `primer_intento_ok`.
        const trasDevolucion = filas.find((f) => f.estatus === "devuelta");
        const alPrimerIntento = filas.find((f) => f.estatus === "pendiente");
        expect(trasDevolucion).toBeDefined();
        expect(alPrimerIntento).toBeDefined();
        expect([trasDevolucion?.entregas, trasDevolucion?.primerIntentoOk]).toEqual([1, 0]);
        expect([alPrimerIntento?.entregas, alPrimerIntento?.primerIntentoOk]).toEqual([1, 1]);
        expect(filas).toHaveLength(2);
      });
    });

    it("la orden creada hace CINCO dias y entregada hoy atribuye el ciclo a la fecha del terminal (R19)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR("2001-06-10", "09:00:00");
        const o = await crearOrden(tx, base, {
          clave: "ciclo-largo",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "15:00:00"),
          destino: "entregada",
        });

        // La fecha de CREACION no lleva ciclo: el dia D-5 solo ve una orden viva.
        await correr(tx, "2001-06-10");
        expect(await resumenes(tx, base, "2001-06-10")).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);

        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: null,
            estatus: "entregada",
            causa: null,
            ordenesEstadoStock: 1,
            segCicloAcum: 5 * 86400 + 6 * 3600,
            segCicloN: 1,
          },
        ]);
      });
    });

    it("la orden que entra a terminal, se revierte y vuelve el mismo dia sigue aportando n = 1 (R19)", async () => {
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        const o = await crearOrden(tx, base, {
          clave: "ida-y-vuelta",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "12:00:00"),
          destino: "entregada",
        });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "14:00:00"),
          destino: "en_reparto",
        });
        await agregarTransicion(tx, base, o, {
          at: instanteCR(FECHA_D, "18:00:00"),
          destino: "entregada",
        });

        await correr(tx, FECHA_D);
        const filas = await leerFilas(tx, base, FECHA_D);
        expect(filas).toHaveLength(1);
        expect(filas[0].segCicloN).toBe(1);
        expect(filas[0].segCicloAcum).toBe(10 * 3600); // el ULTIMO terminal del dia
      });
    });
  });

  // ---------------------------------------------------------------- T6.5 idempotencia

  describe("idempotencia y filas rancias (T6.5)", () => {
    /** Siembra con cubo sin asignar, cubo de gestion y cubo con causa: los tres a la vez. */
    async function sembrarMezcla(tx: TxDeTest, base: BaseSembrada): Promise<{ gestionId: string }> {
      const nacida = instanteCR(FECHA_D, "08:00:00");
      const sinAsignar = await crearOrden(tx, base, {
        clave: "mezcla-sin-asignar",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: nacida,
      });
      await agregarTransicion(tx, base, sinAsignar, { at: nacida, destino: "pendiente" });

      const conGestion = await crearOrden(tx, base, {
        clave: "mezcla-gestionada",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        mensajeroId: base.mensajero1,
        createdAt: nacida,
      });
      await agregarTransicion(tx, base, conGestion, { at: nacida, destino: "pendiente" });
      const gestionId = await crearGestion(tx, {
        ordenId: conGestion,
        mensajeroId: base.mensajero1,
        resultado: "devuelta",
        at: instanteCR(FECHA_D, "12:00:00"),
        causaDevolucion: "wrong_address",
      });
      return { gestionId };
    }

    it("dos corridas seguidas dejan el MISMO conjunto de filas, con created_at intacto (R27/R28)", async () => {
      await conBase(async (tx, base) => {
        await sembrarMezcla(tx, base);

        const r1 = await correr(tx, FECHA_D);
        const primera = await leerFilas(tx, base, FECHA_D);
        const r2 = await correr(tx, FECHA_D);
        const segunda = await leerFilas(tx, base, FECHA_D);

        expect(r2.filasEscritas).toBe(r1.filasEscritas);
        expect(r2.filasRetiradas).toBe(0);
        expect(segunda.map(resumen)).toEqual(primera.map(resumen));
        expect(segunda.map(claveOrden)).toEqual(primera.map(claveOrden));
        for (let i = 0; i < primera.length; i += 1) {
          expect(segunda[i].createdAt).toEqual(primera[i].createdAt);
          expect(segunda[i].updatedAt.getTime()).toBeGreaterThan(primera[i].updatedAt.getTime());
        }
        // R28: el cubo sin asignar (mensajero NULL, causa NULL) NO se duplica pese a que en
        // SQL `NULL != NULL`. Lo sostiene el `NULLS NOT DISTINCT` del unico del grano.
        const nulos = segunda.filter((f) => f.mensajero === null && f.causa === null);
        expect(nulos).toHaveLength(1);
        const conCausa = segunda.filter((f) => f.causa !== null);
        expect(conCausa).toHaveLength(1);
      });
    });

    it("el cubo que deja de producirse desaparece en la corrida siguiente (R29)", async () => {
      await conBase(async (tx, base) => {
        const { gestionId } = await sembrarMezcla(tx, base);

        await correr(tx, FECHA_D);
        const antes = await leerFilas(tx, base, FECHA_D);
        expect(antes.filter((f) => f.devoluciones > 0)).toHaveLength(1);

        // La unica gestion de ese cubo se anula: el cubo deja de existir.
        await tx.gestionOrden.update({
          where: { id: gestionId },
          data: { anuladaAt: instanteCR(FECHA_D_MAS_1, "09:00:00") },
        });

        const r = await correr(tx, FECHA_D);
        const despues = await leerFilas(tx, base, FECHA_D);
        expect(r.filasRetiradas).toBe(1);
        expect(despues.filter((f) => f.causa !== null)).toEqual([]);
        expect(despues.every((f) => f.devoluciones === 0)).toBe(true);
        expect(despues.length).toBe(antes.length - 1);
      });
    });
  });

  // ---------------------------------------------------------------- T6.6 atomicidad

  describe("atomicidad y reconciliacion (T6.6)", () => {
    /** Una fila valida cualquiera, para forzar escrituras a mano contra el repositorio. */
    function filaDe(base: BaseSembrada, parcial: Partial<FilaRollup> = {}): FilaRollup {
      return {
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        mensajeroId: base.mensajero1,
        estatusId: estatusId(base, "pendiente"),
        causaDevolucion: null,
        ordenesCreadas: 0,
        ordenesEstadoStock: 0,
        entregas: 0,
        devoluciones: 0,
        rechazos: 0,
        reprogramaciones: 0,
        incidentes: 0,
        primerIntentoOk: 0,
        segCicloAcum: BigInt(0),
        segCicloN: 0,
        ...parcial,
      };
    }

    async function sembrarUnaOrden(tx: TxDeTest, base: BaseSembrada): Promise<void> {
      const nacida = instanteCR(FECHA_D, "08:00:00");
      const o = await crearOrden(tx, base, {
        clave: "atomica",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: nacida,
      });
      await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
    }

    it("un fallo a mitad de la escritura deja la fecha EXACTAMENTE como estaba (R30)", async () => {
      await conBase(async (tx, base) => {
        await sembrarUnaOrden(tx, base);
        await correr(tx, FECHA_D);
        const antes = await leerFilas(tx, base, FECHA_D);
        expect(antes).toHaveLength(1);

        const repo = crearRepositorio(tx);
        await expect(
          repo.escribirFecha({
            fecha: FECHA_D,
            // Un cubo NUEVO: si la escritura no fuera todo-o-nada, sobreviviria. Y el barrido
            // de rancias, que corre ANTES del fallo, habria borrado la fila legitima.
            filas: [filaDe(base, { mensajeroId: base.mensajero2, ordenesCreadas: 7 })],
            verificarReconciliacion: () => {
              throw new Error("fallo forzado a mitad de la escritura");
            },
          }),
        ).rejects.toThrow("fallo forzado a mitad de la escritura");

        expect(await leerFilas(tx, base, FECHA_D)).toEqual(antes);
      });
    });

    it("la reconciliacion recibe las sumas REALMENTE persistidas de la fecha (R34)", async () => {
      await conBase(async (tx, base) => {
        await sembrarUnaOrden(tx, base);
        const repo = crearRepositorio(tx);
        const totales = await repo.totalesDeControl(ventanaDelDia(FECHA_D));
        const vistas: MedidasReconciliables[] = [];

        await repo.escribirFecha({
          fecha: FECHA_D,
          filas: [filaDe(base, { ordenesCreadas: 1, ordenesEstadoStock: 1 })],
          verificarReconciliacion: (sumas) => vistas.push(sumas),
        });

        expect(vistas).toHaveLength(1);
        expect(vistas[0]).toEqual(totales);
        expect(totales.ordenesCreadas).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------- T6.7 los tres CHECK

  describe("los tres CHECK de la 123, ejercidos contra el motor (T6.7)", () => {
    /** Los CHECK que la 123 dejo en la tabla, leidos del catalogo de Postgres. */
    async function checksDeLaTabla(tx: TxDeTest): Promise<Map<string, string>> {
      const filas = await tx.$queryRaw<{ conname: string; def: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'analytics_daily'::regclass AND contype = 'c'`;
      return new Map(filas.map((f) => [f.conname, f.def]));
    }

    /**
     * Nombre de la restriccion CAPTURADO del error de Postgres, NO inferido del que se espera.
     *
     * El mensaje viene en el idioma del servidor (la base local responde en espanol: «el nuevo
     * registro ... viola la restriccion «check» «...»»), asi que en vez de casar una frase se
     * extraen TODOS los identificadores entrecomillados del texto y se cruzan con los CHECK que
     * el catalogo dice que tiene la tabla. Se exige que quede EXACTAMENTE uno: si el error no
     * nombrara ninguno —o nombrara dos— el caso falla en vez de dar por buena una suposicion.
     */
    async function connameDelError(tx: TxDeTest, error: unknown): Promise<string> {
      const texto = error instanceof Error ? error.message : String(error);
      expect(texto).toContain("23514"); // SQLSTATE de check_violation
      const checks = await checksDeLaTabla(tx);
      const entrecomillados = [...texto.matchAll(/[«"']([^«»"']+)[»"']/g)].map((m) => m[1]);
      const nombrados = [...new Set(entrecomillados.filter((c) => checks.has(c)))];
      if (nombrados.length !== 1) {
        throw new Error(
          `el error no nombra exactamente UNA restriccion CHECK de la tabla ` +
            `(encontradas: ${JSON.stringify(nombrados)}):\n${texto}`,
        );
      }
      return nombrados[0];
    }

    async function rechazoDe(
      tx: TxDeTest,
      base: BaseSembrada,
      medidas: Partial<FilaRollup>,
    ): Promise<{ conname: string; def: string | undefined }> {
      const repo = crearRepositorio(tx);
      const fila: FilaRollup = {
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        mensajeroId: base.mensajero1,
        estatusId: estatusId(base, "pendiente"),
        causaDevolucion: null,
        ordenesCreadas: 0,
        ordenesEstadoStock: 0,
        entregas: 0,
        devoluciones: 0,
        rechazos: 0,
        reprogramaciones: 0,
        incidentes: 0,
        primerIntentoOk: 0,
        segCicloAcum: BigInt(0),
        segCicloN: 0,
        ...medidas,
      };
      let capturado: unknown;
      try {
        await repo.escribirFecha({
          fecha: FECHA_D,
          filas: [fila],
          verificarReconciliacion: () => {},
        });
      } catch (error) {
        capturado = error;
      }
      expect(capturado).toBeDefined();
      const conname = await connameDelError(tx, capturado);
      return { conname, def: (await checksDeLaTabla(tx)).get(conname) };
    }

    it("primer_intento_ok > entregas lo rechaza la base (R18)", async () => {
      await conBase(async (tx, base) => {
        const { conname, def } = await rechazoDe(tx, base, { entregas: 0, primerIntentoOk: 1 });
        expect(def).toBeDefined();
        expect(def).toContain("primer_intento_ok <= entregas");
        expect(conname).toBe("analytics_daily_pio_lte_entregas");
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });

    it("seg_ciclo_n = 0 con seg_ciclo_acum > 0 lo rechaza la base (R20)", async () => {
      await conBase(async (tx, base) => {
        const { conname, def } = await rechazoDe(tx, base, {
          segCicloN: 0,
          segCicloAcum: BigInt(90),
        });
        expect(def).toBeDefined();
        expect(def).toContain("seg_ciclo_n > 0");
        expect(def).toContain("seg_ciclo_acum = 0");
        expect(conname).toBe("analytics_daily_ciclo_coherente");
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });

    it("una medida NEGATIVA la rechaza la base", async () => {
      await conBase(async (tx, base) => {
        const { conname, def } = await rechazoDe(tx, base, { ordenesCreadas: -1 });
        expect(def).toBeDefined();
        expect(def).toContain("ordenes_creadas >= 0");
        expect(conname).toBe("analytics_daily_medidas_no_negativas");
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });

    it("los tres rechazos nombran TRES restricciones distintas", async () => {
      await conBase(async (tx, base) => {
        const nombres = [
          (await rechazoDe(tx, base, { entregas: 0, primerIntentoOk: 1 })).conname,
          (await rechazoDe(tx, base, { segCicloN: 0, segCicloAcum: BigInt(90) })).conname,
          (await rechazoDe(tx, base, { ordenesCreadas: -1 })).conname,
        ];
        expect(new Set(nombres).size).toBe(3);
      });
    });
  });

  // ---------------------------------------------------------------- T6.8 R49

  describe("R49 — caracterizacion de la REPRODUCIBILIDAD PARCIAL (T6.8, D1->A2 + D7)", () => {
    /**
     * ⚠️ LOS TRES CASOS DE ESTE BLOQUE FIJAN LA REBAJA ACORDADA DE R35 DE LA 123.
     *
     * La 123 vendia "inmutabilidad hacia atras" y su design.md §6 le regalaba a la 128 que "lo
     * calculado una vez sigue valiendo". Bajo D1->A2 eso SOLO es cierto en la dimension
     * `estatus`: zona, tienda y mensajero se leen en vivo en cada corrida, y bajo D7 una orden
     * borrada desaparece del pasado. No es un defecto latente: es lo decidido.
     *
     * MOVER CUALQUIERA DE ESTAS TRES ASERCIONES EXIGE REABRIR D1 (y D7 para la tercera). Si (b)
     * se pone rojo, alguien congelo una coordenada sin decidirlo; si (a) se pone rojo, alguien
     * dejo de congelar el estatus; si (c) se pone rojo, alguien dejo de excluir las borradas.
     */
    async function sembrarParaR49(tx: TxDeTest, base: BaseSembrada): Promise<string> {
      const nacida = instanteCR(FECHA_D, "08:00:00");
      const o = await crearOrden(tx, base, {
        clave: "r49",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        mensajeroId: base.mensajero1,
        createdAt: nacida,
      });
      await agregarTransicion(tx, base, o, { at: nacida, destino: "pendiente" });
      return o;
    }

    it("(a) recomputar tras un cambio de estatus posterior escribe el MISMO estatus_id", async () => {
      await conBase(async (tx, base) => {
        const o = await sembrarParaR49(tx, base);
        await correr(tx, FECHA_D);
        expect((await leerFilas(tx, base, FECHA_D)).map((f) => f.estatus)).toEqual(["pendiente"]);

        // La orden se mueve DESPUES del corte de D (y tambien cambia `orden.estatus_id`).
        await agregarTransicion(tx, base, o, {
          at: instanteCR("2001-06-17", "10:00:00"),
          destino: "entregada",
        });
        await tx.orden.update({
          where: { id: o },
          data: { estatusId: estatusId(base, "entregada") },
        });

        await correr(tx, FECHA_D);
        // Coordenada CONGELADA: `orden_historial_estado` es append-only, asi que el estatus
        // al corte de D se reproduce para siempre.
        expect((await leerFilas(tx, base, FECHA_D)).map((f) => f.estatus)).toEqual(["pendiente"]);
      });
    });

    it("(b) recomputar tras reasignar mensajero / cambiar zona / cambiar tienda escribe las coordenadas NUEVAS", async () => {
      await conBase(async (tx, base) => {
        const o = await sembrarParaR49(tx, base);
        await correr(tx, FECHA_D);
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaA",
            tienda: "tienda1",
            mensajero: "mensajero1",
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);

        await tx.orden.update({
          where: { id: o },
          data: {
            zonaId: base.zonaB,
            tiendaId: base.tienda2,
            mensajeroAsignadoId: base.mensajero2,
          },
        });

        await correr(tx, FECHA_D);
        // EL RECOMPUTO NO REPRODUCE LA FILA ORIGINAL. Es lo acordado en D1->A2, no un bug.
        expect(await resumenes(tx, base, FECHA_D)).toEqual([
          {
            zona: "zonaB",
            tienda: "tienda2",
            mensajero: "mensajero2",
            estatus: "pendiente",
            causa: null,
            ordenesCreadas: 1,
            ordenesEstadoStock: 1,
          },
        ]);
      });
    });

    it("(c) recomputar tras BORRAR la orden retira sus contribuciones del pasado (D7)", async () => {
      await conBase(async (tx, base) => {
        const o = await sembrarParaR49(tx, base);
        await correr(tx, FECHA_D);
        expect(await leerFilas(tx, base, FECHA_D)).toHaveLength(1);

        await tx.orden.update({
          where: { id: o },
          data: { deletedAt: instanteCR("2001-06-20", "10:00:00") },
        });

        const r = await correr(tx, FECHA_D);
        // El dia D existio y esa orden estuvo viva en el: aun asi, desaparece del pasado.
        expect(r.filasEscritas).toBe(0);
        expect(r.filasRetiradas).toBe(1);
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------- exclusion silenciosa

  describe("exclusiones declaradas", () => {
    it("la orden SIN ninguna transicion anterior al corte queda FUERA del rollup", async () => {
      // Caracterizacion, no aprobacion: `estatus_id` es una coordenada NOT NULL del grano y la
      // unica fuente admitida es `orden_historial_estado` (R24 prohibe `orden.estatus_id`), asi
      // que una orden sin historial no tiene cubo al que ir. Hoy el `JOIN` con la CTE del
      // estatus al corte la deja fuera de TODAS las medidas —incluida `ordenes_creadas`, que
      // por si sola no la necesitaria— y `totalesDeControl` replica la misma exclusion con su
      // `EXISTS`, de modo que la reconciliacion no la caza. En la practica el choke point de la
      // 49/R6 garantiza que toda orden nace con su transicion de creacion; este caso fija el
      // comportamiento por si esa garantia se rompiera, en vez de dejarlo latente.
      await conBase(async (tx, base) => {
        const nacida = instanteCR(FECHA_D, "08:00:00");
        await crearOrden(tx, base, {
          clave: "sin-historial",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: nacida,
        });
        const control = await crearOrden(tx, base, {
          clave: "con-historial",
          zonaId: base.zonaA,
          tiendaId: base.tienda2,
          createdAt: nacida,
        });
        await agregarTransicion(tx, base, control, { at: nacida, destino: "pendiente" });

        await correr(tx, FECHA_D);
        const filas: FilaLeida[] = await leerFilas(tx, base, FECHA_D);
        expect(filas.map((f) => f.tienda)).toEqual(["tienda2"]);
        expect(filas[0].ordenesCreadas).toBe(1);
      });
    });
  });
});
