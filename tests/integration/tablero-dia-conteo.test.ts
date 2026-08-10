import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import {
  AHORA,
  FECHA_CR,
  VENTANA,
  crearGestion,
  crearOrden,
  instanteCR,
  repositorio,
  sembrarBase,
  sumaDeLosOcho,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 192 (B2.4) — R18, R19, R20, R21, R22, R23, R25, R26, R43, R44.
//
// El conteo se prueba contra un Postgres DE VERDAD porque lo que hay que demostrar son hechos
// del motor: que `DISTINCT ON` colapsa las N gestiones de una orden a la ultima, que un
// `LEFT JOIN` con `resultado IS NULL` reparte las que no tienen gestion en tres cubos
// disjuntos, y que los ocho sumandos suman exactamente las asignadas. Una regex sobre el SQL
// no puede demostrar ninguna de las tres.
//
// EN CADA ESCENARIO se asserta la identidad de R25. No es ceremonia: es la propiedad de la que
// depende que la pantalla sea creible, y el unico sitio donde se rompe sin avisar.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("tablero del dia — el conteo (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Corre el repositorio real sobre la siembra y devuelve las filas por mensajero. */
  async function conteo(
    sembrar: (tx: TxDeTest, base: BaseSembrada) => Promise<void>,
  ): Promise<readonly FilaTableroDia[]> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrar(tx, base);
      const filas = await repositorio(tx).contarPorMensajero(VENTANA, { tipo: "global" });
      // Solo las filas de ESTA siembra: la base de desarrollo puede tener lo que quiera.
      return filas.filter((f) => f.mensajeroNombre.endsWith("Prueba"));
    });
  }

  function identidad(filas: readonly FilaTableroDia[]): void {
    for (const f of filas) expect(f.asignadas).toBe(sumaDeLosOcho(f));
  }

  it("con cero siembra no devuelve ninguna fila: el dia sembrado esta aislado", async () => {
    const filas = await conteo(async () => {});
    expect(filas).toEqual([]);
    expect(VENTANA.fecha).toBe(FECHA_CR);
    expect(AHORA.toISOString()).toBe("2001-06-16T01:00:00.000Z");
  });

  it("una orden con TRES gestiones vigentes el mismo dia aporta 1, con el resultado de la ULTIMA (R19/R20)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "reintentada",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "incidente",
        at: instanteCR(FECHA_CR, "11:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "13:00"),
      });
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].asignadas).toBe(1);
    expect(filas[0].entregadas).toBe(1);
    expect(filas[0].reprogramadas).toBe(0);
    expect(filas[0].incidentes).toBe(0);
    identidad(filas);
  });

  it("una orden SIN gestion cae en el bucket que le toca por su estatus (R21/R43/R44)", async () => {
    const filas = await conteo(async (tx, base) => {
      for (const [clave, estatus] of [
        ["a", "por_recoger"],
        ["b", "recolectando"],
        ["c", "en_reparto"],
        ["d", "por_recolectar_en_tienda"],
        ["e", "en_bodega_central"],
      ] as const) {
        await crearOrden(tx, base, {
          clave,
          estatus,
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        });
      }
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      asignadas: 5,
      // `por_recoger` + `recolectando`
      sinRecoger: 2,
      enReparto: 1,
      // `por_recolectar_en_tienda` NO es "sin recoger" (R44: ahi nadie va todavia), y
      // `en_bodega_central` tampoco (R45).
      otros: 2,
      entregadas: 0,
    });
    identidad(filas);
  });

  it("si TODAS las gestiones del dia estan anuladas, la orden vuelve a clasificarse por su estatus (R22)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "anulada",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "09:00"),
        anuladaAt: instanteCR(FECHA_CR, "10:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "devuelta",
        at: instanteCR(FECHA_CR, "11:00"),
        anuladaAt: instanteCR(FECHA_CR, "12:00"),
      });
    });

    expect(filas[0]).toMatchObject({ asignadas: 1, entregadas: 0, devueltas: 0, enReparto: 1 });
    identidad(filas);
  });

  it("una gestion anulada no tapa a la vigente anterior: gana la ultima VIGENTE (R22)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "mixta",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "devuelta",
        at: instanteCR(FECHA_CR, "15:00"),
        anuladaAt: instanteCR(FECHA_CR, "16:00"),
      });
    });

    expect(filas[0]).toMatchObject({ asignadas: 1, entregadas: 1, devueltas: 0 });
    identidad(filas);
  });

  it("las gestiones FUERA de la ventana no cuentan, aunque la orden sea de hoy (R23)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "mañana",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      // 00:30 CR del dia SIGUIENTE: fuera de `[00:00, 24:00)` de hoy por media hora.
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR("2001-06-16", "00:30"),
      });
      // Y 23:00 CR del dia ANTERIOR, por el otro extremo.
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "devuelta",
        at: instanteCR("2001-06-14", "23:00"),
      });
    });

    expect(filas[0]).toMatchObject({ asignadas: 1, entregadas: 0, devueltas: 0, enReparto: 1 });
    identidad(filas);
  });

  it("una gestion en el ULTIMO milisegundo del dia SI cuenta; la de la medianoche siguiente NO (R12/R23)", async () => {
    const filas = await conteo(async (tx, base) => {
      const dentro = await crearOrden(tx, base, {
        clave: "borde-dentro",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearGestion(tx, {
        ordenId: dentro,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: new Date(VENTANA.hasta.getTime() - 1),
      });

      const fuera = await crearOrden(tx, base, {
        clave: "borde-fuera",
        estatus: "en_reparto",
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearGestion(tx, {
        ordenId: fuera,
        mensajeroId: base.mensajero2,
        resultado: "entregada",
        at: VENTANA.hasta,
      });
    });

    const ana = filas.find((f) => f.mensajeroNombre.startsWith("Ana"));
    const beto = filas.find((f) => f.mensajeroNombre.startsWith("Beto"));
    expect(ana).toMatchObject({ asignadas: 1, entregadas: 1 });
    expect(beto).toMatchObject({ asignadas: 1, entregadas: 0, enReparto: 1 });
    identidad(filas);
  });

  it("una orden asignada a las 23:00 CR de AYER no aparece hoy (R14)", async () => {
    const filas = await conteo(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "ayer",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR("2001-06-14", "23:00"),
      });
    });
    expect(filas).toEqual([]);
  });

  it("una orden asignada a las 00:30 CR de HOY si aparece (R15)", async () => {
    const filas = await conteo(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "madrugada",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "00:30"),
      });
    });
    expect(filas[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(filas);
  });

  it("el resultado se atribuye al mensajero ASIGNADO, aunque la gestion la registre otro (R26)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "gestionada-por-otro",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      // La gestion la registra el OTRO mensajero (o un maestro cubriendo): la tarjeta sigue
      // siendo la del asignado. Atribuirla al actor pondria el trabajo en la tarjeta
      // equivocada y el mensajero lo veria en su pago.
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero2,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "10:00"),
      });
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].mensajeroNombre).toContain("Ana");
    expect(filas[0]).toMatchObject({ asignadas: 1, entregadas: 1 });
    identidad(filas);
  });

  it("una orden SIN mensajero asignado no aparece en ninguna tarjeta (R18)", async () => {
    const filas = await conteo(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "sin-mensajero",
        estatus: "en_bodega_central",
        mensajeroId: null,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
    });
    expect(filas).toEqual([]);
  });

  it("un escenario mixto reparte los ocho cubos y la identidad se cumple en cada tarjeta (R25)", async () => {
    const filas = await conteo(async (tx, base) => {
      const casos = [
        { clave: "e1", estatus: "entregada", resultado: "entregada" as const },
        { clave: "e2", estatus: "entregada", resultado: "entregada" as const },
        { clave: "r1", estatus: "reprogramada", resultado: "reprogramada" as const },
        { clave: "d1", estatus: "devuelta", resultado: "devuelta" as const },
        { clave: "x1", estatus: "rechazada", resultado: "rechazada" as const },
        { clave: "i1", estatus: "incidente", resultado: "incidente" as const },
      ];
      for (const caso of casos) {
        const orden = await crearOrden(tx, base, {
          clave: caso.clave,
          estatus: caso.estatus,
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        });
        await crearGestion(tx, {
          ordenId: orden,
          mensajeroId: base.mensajero1,
          resultado: caso.resultado,
          at: instanteCR(FECHA_CR, "10:00"),
        });
      }
      for (const [clave, estatus] of [
        ["p1", "por_recoger"],
        ["p2", "en_reparto"],
        ["p3", "en_bodega_satelite"],
      ] as const) {
        await crearOrden(tx, base, {
          clave,
          estatus,
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "08:00"),
        });
      }
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      asignadas: 9,
      entregadas: 2,
      reprogramadas: 1,
      devueltas: 1,
      rechazadas: 1,
      incidentes: 1,
      sinRecoger: 1,
      enReparto: 1,
      otros: 1,
    });
    identidad(filas);
  });

  it("devuelve una fila por mensajero, no una por orden (R39)", async () => {
    const filas = await conteo(async (tx, base) => {
      for (let i = 0; i < 6; i += 1) {
        await crearOrden(tx, base, {
          clave: `carga-${i}`,
          estatus: "en_reparto",
          mensajeroId: i % 2 === 0 ? base.mensajero1 : base.mensajero2,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        });
      }
    });

    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.asignadas)).toEqual([3, 3]);
    identidad(filas);
  });
});
