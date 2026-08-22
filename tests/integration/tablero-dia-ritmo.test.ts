import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  EntregasEnHora,
  FiltroAlcanceTablero,
} from "@/lib/interfaces/repositories/ITableroDiaRepository";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import {
  FECHA_CR,
  VENTANA,
  crearGestion,
  crearOrden,
  diaReparto,
  instanteCR,
  repositorio,
  sembrarBase,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-tablero-dia";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./db/_postgres-real";

// Feature 258 (B5.1) — R51, R52, R53, R55, R72.
//
// La serie de entregas por hora se prueba contra un Postgres DE VERDAD porque lo que hay que
// demostrar son hechos del motor, y ninguno lo puede demostrar una regex sobre el SQL ni un
// doble de repositorio:
//
//   · que `DISTINCT ON` colapse las N gestiones del dia de una orden a la ULTIMA, de modo que
//     una orden aporte exactamente 1 y en la hora de esa gestion final;
//   · que `FLOOR(EXTRACT(EPOCH FROM (at - desde::timestamp)) / 3600)` produzca la hora de
//     PARED de Costa Rica y no la hora UTC (seis puestos mas alla);
//   · que el `WHERE` del alcance recorte de verdad;
//   · y sobre todo, que la suma de la serie sea EXACTAMENTE el contador `entregadas` que
//     devuelve la otra consulta sobre la MISMA siembra (R52). Ese cuadre es la razon de ser de
//     esta lectura: la linea y el contador se pintan a dos centimetros uno del otro.
//
// ⛔ NINGUN escenario devuelve antes de comprobar. Si la siembra no se puede hacer, el helper
// `sembrarBase` LANZA y el test falla: un `if (!datos) return;` reportaria `passed` sobre una
// base vacia sin haber comprobado nada (ya paso en este repo).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El total de entregas que dice la serie: es lo que la pantalla pinta como ultimo punto. */
function totalDeLaSerie(serie: readonly EntregasEnHora[]): number {
  return serie.reduce((acc, h) => acc + h.entregadas, 0);
}

describeSiHayBase("tablero del dia — la serie de entregas por hora (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Corre las DOS consultas reales sobre la MISMA siembra y en la MISMA transaccion. */
  async function medir(
    sembrar: (tx: TxDeTest, base: BaseSembrada) => Promise<void>,
    filtro: (base: BaseSembrada) => FiltroAlcanceTablero = () => ({ tipo: "global" }),
  ): Promise<{ serie: readonly EntregasEnHora[]; filas: readonly FilaTableroDia[] }> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrar(tx, base);
      const repo = repositorio(tx);
      const [serie, filas] = await Promise.all([
        repo.contarEntregasPorHora(VENTANA, filtro(base)),
        repo.contarPorMensajero(VENTANA, filtro(base)),
      ]);
      return {
        serie,
        // Solo las filas de ESTA siembra: la base de desarrollo puede tener lo que quiera.
        filas: filas.filter((f) => f.mensajeroNombre.endsWith("Prueba")),
      };
    });
  }

  /** Una orden asignada hoy al mensajero 1, en la zona A salvo que se diga otra cosa. */
  async function ordenDelDia(
    tx: TxDeTest,
    base: BaseSembrada,
    clave: string,
    opciones: { zonaId?: string; mensajeroId?: string; estatus?: string } = {},
  ): Promise<string> {
    return crearOrden(tx, base, {
      clave,
      estatus: opciones.estatus ?? "entregada",
      mensajeroId: opciones.mensajeroId ?? base.mensajero1,
      zonaId: opciones.zonaId,
      asignadoAt: instanteCR(FECHA_CR, "07:00"),
    });
  }

  it("con cero siembra la serie viene VACIA: el dia sembrado esta aislado", async () => {
    const { serie, filas } = await medir(async () => {});

    // Si esto no fuera cierto, todos los escenarios de abajo estarian midiendo datos ajenos.
    expect(serie).toEqual([]);
    expect(filas).toEqual([]);
    expect(VENTANA.fecha).toBe(FECHA_CR);
  });

  it("ESCENARIO 1 (R52) — la suma de la serie es EXACTAMENTE el contador `entregadas`", async () => {
    const { serie, filas } = await medir(async (tx, base) => {
      // Un dia con de todo: entregas de dos mensajeros a horas distintas, y ruido que NO debe
      // entrar en la serie (una reprogramada, una devuelta y una sin gestion ninguna).
      const horas: [string, string][] = [
        ["e-0730", "07:30"],
        ["e-0745", "07:45"],
        ["e-1015", "10:15"],
        ["e-1600", "16:00"],
      ];
      for (const [clave, hora] of horas) {
        const orden = await ordenDelDia(tx, base, clave);
        await crearGestion(tx, {
          ordenId: orden,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_CR, hora),
        });
      }

      const delDos = await ordenDelDia(tx, base, "e-otro-mensajero", {
        mensajeroId: base.mensajero2,
      });
      await crearGestion(tx, {
        ordenId: delDos,
        mensajeroId: base.mensajero2,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "10:40"),
      });

      const reprogramada = await ordenDelDia(tx, base, "ruido-repro", { estatus: "reprogramada" });
      await crearGestion(tx, {
        ordenId: reprogramada,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "11:00"),
      });

      const devuelta = await ordenDelDia(tx, base, "ruido-devuelta", { estatus: "devuelta" });
      await crearGestion(tx, {
        ordenId: devuelta,
        mensajeroId: base.mensajero1,
        resultado: "devuelta",
        at: instanteCR(FECHA_CR, "12:00"),
      });

      await ordenDelDia(tx, base, "ruido-sin-gestion", { estatus: "en_reparto" });
    });

    const entregadasDelTablero = filas.reduce((acc, f) => acc + f.entregadas, 0);
    expect(entregadasDelTablero).toBe(5);
    expect(totalDeLaSerie(serie)).toBe(entregadasDelTablero);
    // Y el reparto por hora es el de las horas de PARED, no el de las horas UTC.
    expect([...serie]).toEqual([
      { hora: 7, entregadas: 2 },
      { hora: 10, entregadas: 2 },
      { hora: 16, entregadas: 1 },
    ]);
  });

  it("ESCENARIO 2 (R51) — una orden con TRES gestiones cuenta UNA vez, en la hora de la ULTIMA", async () => {
    const { serie, filas } = await medir(async (tx, base) => {
      const orden = await ordenDelDia(tx, base, "reintentada");
      // Tres gestiones vigentes el mismo dia; la ULTIMA es la que manda.
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "08:00"),
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
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "14:20"),
      });
    });

    // UNA sola, y en las 14 — no dos (una por cada gestion `entregada`) ni en las 9.
    expect([...serie]).toEqual([{ hora: 14, entregadas: 1 }]);
    expect(totalDeLaSerie(serie)).toBe(1);
    expect(filas.reduce((acc, f) => acc + f.entregadas, 0)).toBe(1);
  });

  it("ESCENARIO 3 (R72) — entregada a las 10:00 y reprogramada a las 15:00: el punto de las 10:00 BAJA, y eso es lo ESPERADO", async () => {
    // ⚠️ ESTE TEST FIJA UNA DECISION HUMANA (2026-08-21), no una tolerancia.
    //
    // La serie se reconstruye entera en cada lectura: cuenta la ULTIMA gestion vigente del dia,
    // igual que el contador `entregadas`. Una orden entregada a las 10:00 y reprogramada a las
    // 15:00 ya no es una entrega, asi que SALE de la serie y el punto de las 10:00 baja en uno
    // respecto del refresco anterior.
    //
    // Tiene que bajar: en ese mismo refresco el contador `entregadas` de la tarjeta tambien
    // bajo. La alternativa —contar cualquier gestion `entregada` del dia— da una curva que
    // nunca retrocede pero que dice un numero distinto del contador que se pinta a dos
    // centimetros de ella. Se prefiere una curva que retrocede y CUADRA a una curva bonita que
    // miente (`design.md` §3 y §12.6).
    //
    // ⛔ SI ALGUIEN "ARREGLA" LA LINEA PARA QUE NO RETROCEDA, ESTE TEST SE PONE ROJO. Esa es
    // toda su razon de ser: que no lo arreglen dentro de seis meses sin leer esto.
    const { serie, filas } = await medir(async (tx, base) => {
      const arrepentida = await ordenDelDia(tx, base, "entregada-y-luego-repro", {
        estatus: "reprogramada",
      });
      await crearGestion(tx, {
        ordenId: arrepentida,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "10:00"),
      });
      await crearGestion(tx, {
        ordenId: arrepentida,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "15:00"),
      });

      // Una entrega de verdad a la MISMA hora, para que la hora 10 exista y se vea que lo que
      // desaparece es la orden arrepentida y no la hora entera.
      const buena = await ordenDelDia(tx, base, "entregada-de-verdad");
      await crearGestion(tx, {
        ordenId: buena,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "10:30"),
      });
    });

    expect([...serie]).toEqual([{ hora: 10, entregadas: 1 }]);
    // Y el contador dice lo mismo: ese es el cuadre que hace CORRECTO el retroceso.
    expect(totalDeLaSerie(serie)).toBe(filas.reduce((acc, f) => acc + f.entregadas, 0));
    expect(filas.reduce((acc, f) => acc + f.reprogramadas, 0)).toBe(1);
  });

  it("ESCENARIO 4 (R53) — 00:30 CR cae en la hora 0 y 23:30 CR en la 23: ninguna se escapa al dia vecino", async () => {
    const { serie, filas } = await medir(async (tx, base) => {
      const primera = await ordenDelDia(tx, base, "madrugada");
      await crearGestion(tx, {
        ordenId: primera,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "00:30"),
      });

      const ultima = await ordenDelDia(tx, base, "de-noche");
      await crearGestion(tx, {
        ordenId: ultima,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "23:30"),
      });

      // El borde EXACTO: 00:00 CR es el primer instante del dia y va a la hora 0.
      const borde = await ordenDelDia(tx, base, "borde-medianoche");
      await crearGestion(tx, {
        ordenId: borde,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "00:00"),
      });
    });

    expect([...serie]).toEqual([
      { hora: 0, entregadas: 2 },
      { hora: 23, entregadas: 1 },
    ]);
    // Ninguna hora fuera de 0..23: un 24 o un -1 seria la hora UTC colandose.
    for (const punto of serie) {
      expect(punto.hora).toBeGreaterThanOrEqual(0);
      expect(punto.hora).toBeLessThanOrEqual(23);
    }
    expect(totalDeLaSerie(serie)).toBe(filas.reduce((acc, f) => acc + f.entregadas, 0));
  });

  it("ESCENARIO 5 (R55) — con alcance de ZONA no aparecen las entregas de otra zona", async () => {
    const sembrarDosZonas = async (tx: TxDeTest, base: BaseSembrada): Promise<void> => {
      const enA = await ordenDelDia(tx, base, "zona-a", { zonaId: base.zonaA });
      await crearGestion(tx, {
        ordenId: enA,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "09:00"),
      });

      const enB = await ordenDelDia(tx, base, "zona-b", { zonaId: base.zonaB });
      await crearGestion(tx, {
        ordenId: enB,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "17:00"),
      });
    };

    const global = await medir(sembrarDosZonas);
    const soloA = await medir(sembrarDosZonas, (base) => ({ tipo: "zona", zonaId: base.zonaA }));

    // Global ve las dos; la zona A ve la suya y NO la de la zona B. Sin el contraste, un
    // recorte que devolviera siempre vacio pasaria por bueno.
    expect(totalDeLaSerie(global.serie)).toBe(2);
    expect([...soloA.serie]).toEqual([{ hora: 9, entregadas: 1 }]);
    expect(totalDeLaSerie(soloA.serie)).toBe(soloA.filas.reduce((a, f) => a + f.entregadas, 0));
    // El recorte mira la zona de la ORDEN, no la del usuario: los dos mensajeros de la semilla
    // pertenecen a la zona B y aun asi la entrega de la zona A es la que se ve.
    expect(soloA.filas.map((f) => f.entregadas)).toEqual([1]);
  });

  it("ESCENARIO 6 — una gestion ANULADA no cuenta, ni siquiera si es la mas reciente", async () => {
    const { serie, filas } = await medir(async (tx, base) => {
      // Entregada a las 08:00 y despues ANULADA: no hay entrega ninguna.
      const anulada = await ordenDelDia(tx, base, "anulada", { estatus: "en_reparto" });
      await crearGestion(tx, {
        ordenId: anulada,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "08:00"),
        anuladaAt: instanteCR(FECHA_CR, "08:30"),
      });

      // Y el caso que de verdad muerde: una entrega VIGENTE a las 11:00 con una gestion
      // posterior ANULADA a las 13:00. La anulada no puede robarle la hora ni el resultado.
      const conRuido = await ordenDelDia(tx, base, "vigente-con-anulada-posterior");
      await crearGestion(tx, {
        ordenId: conRuido,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "11:00"),
      });
      await crearGestion(tx, {
        ordenId: conRuido,
        mensajeroId: base.mensajero1,
        resultado: "rechazada",
        at: instanteCR(FECHA_CR, "13:00"),
        anuladaAt: instanteCR(FECHA_CR, "13:30"),
      });
    });

    expect([...serie]).toEqual([{ hora: 11, entregadas: 1 }]);
    expect(totalDeLaSerie(serie)).toBe(filas.reduce((acc, f) => acc + f.entregadas, 0));
  });

  it("una gestion FUERA de la ventana del dia no entra en la serie", async () => {
    const { serie } = await medir(async (tx, base) => {
      const orden = await ordenDelDia(tx, base, "gestionada-ayer");
      // 23:30 del dia ANTERIOR en hora de pared CR: por debajo de `ventana.desde`.
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: new Date(VENTANA.desde.getTime() - 30 * 60_000),
      });

      const manana = await ordenDelDia(tx, base, "gestionada-manana");
      // `ventana.hasta` es cota EXCLUSIVA: el primer instante del dia siguiente queda fuera.
      await crearGestion(tx, {
        ordenId: manana,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: VENTANA.hasta,
      });
    });

    expect([...serie]).toEqual([]);
  });

  it("FEATURE 259 (R15) — con ordenes de las DOS ramas, el ultimo acumulado sigue siendo `entregadas`", async () => {
    // El cuadre de R52/R15 no depende de COMO entra la orden al universo del dia, sino de que
    // la serie y el contador lean el MISMO universo. Aqui se mezcla a proposito:
    //   · rama (a): reservada para hoy, ASIGNADA AYER — con el criterio viejo no estaria;
    //   · rama (a): reservada para hoy y asignada hoy;
    //   · rama (b): sin dia de reparto, por `asignado_at` (el respaldo);
    //   · y ruido que NO debe entrar: una reservada para MAÑANA, entregada hoy.
    const { serie, filas } = await medir(async (tx, base) => {
      const entregar = async (ordenId: string, hora: string): Promise<void> => {
        await crearGestion(tx, {
          ordenId,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_CR, hora),
        });
      };

      await entregar(
        await crearOrden(tx, base, {
          clave: "r259-a-ayer",
          estatus: "entregada",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR("2001-06-14", "16:00"),
          fechaReparto: diaReparto(FECHA_CR),
        }),
        "09:00",
      );
      await entregar(
        await crearOrden(tx, base, {
          clave: "r259-a-hoy",
          estatus: "entregada",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
          fechaReparto: diaReparto(FECHA_CR),
        }),
        "11:00",
      );
      await entregar(await ordenDelDia(tx, base, "r259-b-respaldo"), "13:00");
      // Reservada para MAÑANA: no es del dia, asi que ni entra en la serie ni en el contador —
      // ni aunque alguien le registrara una gestion hoy.
      await entregar(
        await crearOrden(tx, base, {
          clave: "r259-para-manana",
          estatus: "entregada",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "14:00"),
          fechaReparto: diaReparto("2001-06-16"),
        }),
        "15:00",
      );
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ asignadas: 3, entregadas: 3 });
    // Las tres entregas del dia, cada una en su hora de pared. La de las 15:00 NO esta.
    expect([...serie]).toEqual([
      { hora: 9, entregadas: 1 },
      { hora: 11, entregadas: 1 },
      { hora: 13, entregadas: 1 },
    ]);
    // R15/R52 — el ultimo punto de la serie acumulada ES el contador que se pinta a su lado.
    expect(totalDeLaSerie(serie)).toBe(filas[0].entregadas);
  });
});
