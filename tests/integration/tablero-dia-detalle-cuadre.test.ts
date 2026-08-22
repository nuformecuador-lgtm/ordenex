import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FECHA_CR,
  VENTANA,
  crearGestion,
  crearOrden,
  diaReparto,
  instanteCR,
  repositorio,
  sembrarBase,
  sumaDeLosOcho,
  transicionDeRecoleccion,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 192 (B7.7) — R51.
//
// EL CUADRE ENTRE LAS DOS CONSULTAS. La tarjeta dice "8" y el detalle tiene que traer 8: si
// no, el usuario ve una contradiccion en la misma pantalla y deja de creerse las dos cifras.
//
// Es el test que caza el fallo concreto de esta feature: si el detalle usara SOLO
// `asignado_at`, un mensajero con recolecciones veria una tarjeta que dice 8 y un detalle con
// 5. Por eso los dos comparten literalmente el mismo fragmento de CTE, y por eso este archivo
// mide las dos consultas SOBRE EL MISMO dataset y en el mismo alcance.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PAGINA_GRANDE = { pagina: 1, pageSize: 100 };

describeSiHayBase("detalle vs tarjeta — el cuadre (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra un dia con las dos vias de entrada y compara tarjeta contra detalle. */
  async function cuadrar(
    sembrar: (tx: TxDeTest, base: BaseSembrada) => Promise<void>,
    alcance: (base: BaseSembrada) => { tipo: "global" } | { tipo: "zona"; zonaId: string },
  ) {
    return enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrar(tx, base);

      const repo = repositorio(tx);
      const filtro = alcance(base);
      const filas = (await repo.contarPorMensajero(VENTANA, filtro)).filter((f) =>
        f.mensajeroNombre.endsWith("Prueba"),
      );
      const detalles = await Promise.all(
        filas.map(async (f) => ({
          mensajeroId: f.mensajeroId,
          asignadas: f.asignadas,
          suma: sumaDeLosOcho(f),
          detalle: await repo.listarOrdenesDelDia(VENTANA, filtro, f.mensajeroId, PAGINA_GRANDE),
        })),
      );
      return detalles;
    });
  }

  async function sembrarDiaCompleto(tx: TxDeTest, base: BaseSembrada): Promise<void> {
    // Camino 1 (reparto), con y sin gestion.
    const entregada = await crearOrden(tx, base, {
      clave: "c1-entregada",
      estatus: "entregada",
      mensajeroId: base.mensajero1,
      asignadoAt: instanteCR(FECHA_CR, "07:00"),
    });
    await crearGestion(tx, {
      ordenId: entregada,
      mensajeroId: base.mensajero1,
      resultado: "entregada",
      at: instanteCR(FECHA_CR, "10:00"),
    });
    const reintentada = await crearOrden(tx, base, {
      clave: "c1-reintentada",
      estatus: "reprogramada",
      mensajeroId: base.mensajero1,
      asignadoAt: instanteCR(FECHA_CR, "07:00"),
    });
    for (const [hora, resultado] of [
      ["09:00", "incidente"],
      ["11:00", "reprogramada"],
    ] as const) {
      await crearGestion(tx, {
        ordenId: reintentada,
        mensajeroId: base.mensajero1,
        resultado,
        at: instanteCR(FECHA_CR, hora),
      });
    }
    await crearOrden(tx, base, {
      clave: "c1-sin-gestion",
      estatus: "por_recoger",
      mensajeroId: base.mensajero1,
      asignadoAt: instanteCR(FECHA_CR, "08:00"),
    });

    // Camino 2 (recoleccion), SIN `asignado_at`: si el detalle solo mirara esa columna, estas
    // dos faltarian y el cuadre se rompería.
    const soloRecoleccion = await crearOrden(tx, base, {
      clave: "c2-solo",
      estatus: "recolectando",
      mensajeroId: base.mensajero1,
      asignadoAt: null,
    });
    await transicionDeRecoleccion(tx, base, soloRecoleccion, instanteCR(FECHA_CR, "08:30"));
    const recolectadaYGestionada = await crearOrden(tx, base, {
      clave: "c2-gestionada",
      estatus: "entregada",
      mensajeroId: base.mensajero1,
      asignadoAt: null,
    });
    await transicionDeRecoleccion(tx, base, recolectadaYGestionada, instanteCR(FECHA_CR, "09:30"));
    await crearGestion(tx, {
      ordenId: recolectadaYGestionada,
      mensajeroId: base.mensajero1,
      resultado: "entregada",
      at: instanteCR(FECHA_CR, "16:00"),
    });

    // Los DOS caminos a la vez: sigue siendo UNA orden.
    const ambos = await crearOrden(tx, base, {
      clave: "c1-y-c2",
      estatus: "en_reparto",
      mensajeroId: base.mensajero1,
      asignadoAt: instanteCR(FECHA_CR, "07:30"),
    });
    await transicionDeRecoleccion(tx, base, ambos, instanteCR(FECHA_CR, "07:45"));

    // Y un segundo mensajero, para que la comparacion no sea de una sola tarjeta.
    await crearOrden(tx, base, {
      clave: "beto-1",
      estatus: "en_reparto",
      mensajeroId: base.mensajero2,
      asignadoAt: instanteCR(FECHA_CR, "07:00"),
    });
  }

  it("el total del detalle es igual a las asignadas de la tarjeta, mismo dataset (R51)", async () => {
    const cuadres = await cuadrar(sembrarDiaCompleto, () => ({ tipo: "global" }));

    expect(cuadres).toHaveLength(2);
    for (const c of cuadres) {
      expect(c.detalle.total).toBe(c.asignadas);
      expect(c.detalle.filas).toHaveLength(c.asignadas);
      // Y la identidad de los ocho sumandos se mantiene en la tarjeta comparada (R25).
      expect(c.suma).toBe(c.asignadas);
    }
    // La tarjeta de Ana suma las seis ordenes de las dos vias, contando UNA sola vez la que
    // entra por los dos caminos.
    expect(cuadres.map((c) => c.asignadas).sort()).toEqual([1, 6]);
  });

  it("el cuadre se mantiene bajo el alcance de un satelite: se recortan las DOS consultas (R41/R51)", async () => {
    const cuadres = await cuadrar(async (tx, base) => {
      await sembrarDiaCompleto(tx, base);
      // Ruido en la otra zona: no debe aparecer ni en la tarjeta ni en el detalle.
      const ajena = await crearOrden(tx, base, {
        clave: "zona-b",
        estatus: "en_reparto",
        zonaId: base.zonaB,
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await transicionDeRecoleccion(tx, base, ajena, instanteCR(FECHA_CR, "07:10"));
    }, (base) => ({ tipo: "zona", zonaId: base.zonaA }));

    for (const c of cuadres) {
      expect(c.detalle.total).toBe(c.asignadas);
      expect(c.detalle.filas).toHaveLength(c.asignadas);
    }
    expect(cuadres.map((c) => c.asignadas).sort()).toEqual([1, 6]);
  });

  it("el resultado del dia del detalle coincide con el bucket de la tarjeta, orden a orden (R51)", async () => {
    const detalle = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrarDiaCompleto(tx, base);
      const repo = repositorio(tx);
      const fila = (await repo.contarPorMensajero(VENTANA, { tipo: "global" })).find((f) =>
        f.mensajeroNombre.startsWith("Ana"),
      );
      if (fila === undefined) throw new Error("falta la tarjeta de Ana");
      return {
        fila,
        pagina: await repo.listarOrdenesDelDia(
          VENTANA,
          { tipo: "global" },
          fila.mensajeroId,
          PAGINA_GRANDE,
        ),
      };
    });

    const conResultado = detalle.pagina.filas.filter((f) => f.resultadoDelDia !== null);
    const sinResultado = detalle.pagina.filas.filter((f) => f.resultadoDelDia === null);

    // Las dos consultas comparten la definicion de "resultado del dia" (`DISTINCT ON` y
    // `LATERAL ... LIMIT 1`): si una cambiara sin la otra, estas dos cuentas divergirian.
    expect(conResultado).toHaveLength(
      detalle.fila.entregadas +
        detalle.fila.reprogramadas +
        detalle.fila.devueltas +
        detalle.fila.rechazadas +
        detalle.fila.incidentes,
    );
    expect(sinResultado).toHaveLength(
      detalle.fila.sinRecoger + detalle.fila.enReparto + detalle.fila.otros,
    );
    expect(conResultado.filter((f) => f.resultadoDelDia === "entregada")).toHaveLength(
      detalle.fila.entregadas,
    );
    expect(conResultado.filter((f) => f.resultadoDelDia === "reprogramada")).toHaveLength(
      detalle.fila.reprogramadas,
    );
  });

  it("FEATURE 259 (R14) — el cuadre aguanta mezclando rama (a), rama (b) y recoleccion", async () => {
    // Los ids del RUIDO de mañana, apuntados durante la siembra para poder afirmar abajo que no
    // se colaron en la pagina del dia.
    const idsDeManana: string[] = [];
    // ⚠️ ESTE ARCHIVO AFIRMA UNA IGUALDAD Y LA 259 MUEVE UN LADO DE ELLA. No se afloja nada: los
    // casos que ya existian siguen VERDES SIN TOCARLOS porque ninguno fijaba `fecha_reparto`, o
    // sea que todos ejercitan la rama (b). Lo que hace falta es un caso que ejercite tambien la
    // rama (a) y la de recoleccion A LA VEZ — que es donde el cuadre se rompería si la tarjeta y
    // el detalle dejaran de compartir `cteIdsDelDia`.
    const cuadres = await cuadrar(async (tx, base) => {
      // (a) reservada para hoy, ASIGNADA AYER: con el criterio viejo no estaria en la pantalla.
      await crearOrden(tx, base, {
        clave: "cuadre259-a-ayer",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR("2001-06-14", "16:00"),
        fechaReparto: diaReparto(FECHA_CR),
      });
      // (a) reservada para hoy y asignada hoy.
      await crearOrden(tx, base, {
        clave: "cuadre259-a-hoy",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
        fechaReparto: diaReparto(FECHA_CR),
      });
      // (b) sin dia de reparto: el respaldo por `asignado_at`.
      await crearOrden(tx, base, {
        clave: "cuadre259-b",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "08:00"),
      });
      // Recoleccion de hoy sin dia de reparto: entra solo por el historial.
      const soloRecoleccion = await crearOrden(tx, base, {
        clave: "cuadre259-recoleccion",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, soloRecoleccion, instanteCR(FECHA_CR, "08:30"));
      // Recoleccion de hoy Y reservada para hoy: alcanzable por dos caminos, cuenta UNA vez.
      const porDosCaminos = await crearOrden(tx, base, {
        clave: "cuadre259-dos-caminos",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:30"),
        fechaReparto: diaReparto(FECHA_CR),
      });
      await transicionDeRecoleccion(tx, base, porDosCaminos, instanteCR(FECHA_CR, "07:45"));

      // ── RUIDO QUE NO ES DE HOY ────────────────────────────────────────────────────────────
      // Reservada para mañana: fuera de la tarjeta Y fuera del detalle. Si una consulta la
      // dejara entrar y la otra no, este caso cae — que es justo para lo que existe.
      idsDeManana.push(
        await crearOrden(tx, base, {
          clave: "cuadre259-para-manana",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "14:00"),
          fechaReparto: diaReparto("2001-06-16"),
        }),
      );
      const recoleccionParaManana = await crearOrden(tx, base, {
        clave: "cuadre259-recoleccion-manana",
        estatus: "por_recoger",
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "14:00"),
        fechaReparto: diaReparto("2001-06-16"),
      });
      idsDeManana.push(recoleccionParaManana);
      await transicionDeRecoleccion(
        tx,
        base,
        recoleccionParaManana,
        instanteCR(FECHA_CR, "08:00"),
      );
    }, () => ({ tipo: "global" }));

    // Solo la tarjeta de Ana: la de Beto no existe hoy (su unica orden es de mañana).
    expect(cuadres).toHaveLength(1);
    for (const c of cuadres) {
      expect(c.detalle.total).toBe(c.asignadas);
      expect(c.detalle.filas).toHaveLength(c.asignadas);
      expect(c.suma).toBe(c.asignadas);
    }
    expect(cuadres[0].asignadas).toBe(5);
    // Y el ruido no se coló por el detalle: ninguna orden de mañana aparece en la pagina.
    // FEATURE 260 — se comprueba por ID y no por el nombre del destinatario, que esta consulta
    // ya no proyecta: los ids se apuntaron durante la siembra, arriba.
    expect(idsDeManana).toHaveLength(2);
    const enLaPagina = new Set(cuadres[0].detalle.filas.map((f) => f.ordenId));
    expect(idsDeManana.filter((id) => enLaPagina.has(id))).toEqual([]);
  });
});
