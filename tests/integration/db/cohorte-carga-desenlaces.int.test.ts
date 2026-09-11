import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import {
  agregarTransicion,
  crearGestion,
  crearOrden,
  instanteCR,
  sembrarBase,
} from "./_semilla-rollup";
import {
  cargadasDe,
  consultaDe,
  cubosDelDia,
  D,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.2 — LOS CUATRO CUBOS (R4, R7, R10, R13).
 *
 * ─── EL CONTRATO SE AFIRMA CON UN LITERAL ESCRITO A MANO ────────────────────────────────
 *
 * Los cubos que salen se comparan contra `["devuelta_a_tienda","entregada","incidente","viva"]`
 * TECLEADO AQUI, y no contra `ESTADOS_TERMINALES`. Comparar contra la misma constante que la
 * consulta importa estaria SIEMPRE verde: es una asercion contra su propia fuente. El literal es
 * el contrato de hoy; que la consulta no lo escriba a mano lo vigila, por el otro lado, el censo
 * de `tests/unit/analytics/cohorte-terminales.guardia.test.ts`.
 *
 * ─── LO QUE MAS SE MALINTERPRETA: `devuelta` NO HA TERMINADO NADA ───────────────────────
 *
 * Medido en este repo el 2026-09-10: una orden `devuelta` volvio a bodega, se libero sola a las
 * 24 h, salio otra vez a reparto y se devolvio DE NUEVO cinco dias despues. `devuelta` significa
 * «devolucion anclada», no «lote cerrado»: tiene ocho salidas declaradas en el mapa de
 * transiciones y el paquete sigue en circulacion. Por eso cuenta como `viva`, igual que
 * `rechazada`, `devolucion_por_confirmar` y `sin_gestionar`.
 *
 * CONSECUENCIA que hay que saber al leer la tabla: una cohorte reciente ensena MUCHAS vivas y
 * pocas devueltas, porque el camino `rechazada -> por_devolver -> ... -> devuelta_a_tienda`
 * tarda dias. **Eso no es un bug: es el lote.**
 */

describeSiHayBase("411/T4.2 — cada orden de la cohorte cae en un cubo y en uno solo", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      const cargar = (clave: string) =>
        crearOrden(tx, base, {
          clave,
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: instanteCR(D, "09:00"),
        });

      // Los tres desenlaces TERMINALES.
      const entregada = await cargar("entregada");
      await agregarTransicion(tx, base, entregada, {
        at: instanteCR(D, "18:00"),
        destino: "entregada",
      });

      const devueltaATienda = await cargar("devuelta-a-tienda");
      await agregarTransicion(tx, base, devueltaATienda, {
        at: instanteCR(D, "18:00"),
        destino: "devuelta_a_tienda",
      });

      const incidente = await cargar("incidente");
      await agregarTransicion(tx, base, incidente, {
        at: instanteCR(D, "18:00"),
        destino: "incidente",
      });

      // Las tres que siguen VIVAS: sin ninguna transicion, en `rechazada` y en `devuelta`.
      await cargar("sin-transiciones");

      const rechazada = await cargar("rechazada");
      await agregarTransicion(tx, base, rechazada, {
        at: instanteCR(D, "18:00"),
        destino: "rechazada",
      });

      const devuelta = await cargar("devuelta");
      await agregarTransicion(tx, base, devuelta, {
        at: instanteCR(D, "18:00"),
        destino: "devuelta",
      });

      // R4 — una orden BORRADA no cuenta en ninguna cohorte. Se le pone hasta su transicion
      // terminal para que, si el soft delete se cayera, apareciera en `entregada` y se viera.
      const borrada = await crearOrden(tx, base, {
        clave: "borrada",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "09:00"),
        deletedAt: instanteCR(D, "20:00"),
      });
      await agregarTransicion(tx, base, borrada, {
        at: instanteCR(D, "18:00"),
        destino: "entregada",
      });

      // R13 — la ultima GESTION VIGENTE dice otra cosa que la transicion. El desenlace lo decide
      // la transicion registrada, no la gestion: una orden `reprogramada` tiene gestion y sigue
      // viva, y la gestion tampoco da instante de cierre comparable con `created_at`.
      const gestionMiente = await cargar("gestion-dice-entregada");
      await agregarTransicion(tx, base, gestionMiente, {
        at: instanteCR(D, "18:00"),
        destino: "devuelta_a_tienda",
      });
      await crearGestion(tx, {
        ordenId: gestionMiente,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(D, "19:00"),
      });

      const consulta = consultaDe(rangoDe(D, D), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leerCohortes(tx, consulta) };
    });
  }

  it("los cubos que salen son EXACTAMENTE los cuatro del contrato", async () => {
    const { filas } = await escenario();

    expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);

    const cubos = [...new Set(filas.map((f) => f.desenlace))].sort();
    // LITERAL ESCRITO A MANO: es el contrato, no una copia de `ESTADOS_TERMINALES`.
    expect(cubos).toEqual(["devuelta_a_tienda", "entregada", "incidente", "viva"]);
  });

  it("`rechazada` y `devuelta` cuentan como VIVAS, no como devueltas", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    const cubos = cubosDelDia(filas, D);
    // Tres vivas: la que no tiene ninguna transicion, la `rechazada` y la `devuelta`.
    expect(cubos.get("viva")?.n).toBe(3);
    // Y `devuelta_a_tienda` tiene DOS (la suya y la de la gestion que miente), no cuatro: si
    // `devuelta` o `rechazada` se colaran como devoluciones, esta cifra subiria.
    expect(cubos.get("devuelta_a_tienda")?.n).toBe(2);
  });

  it("cada orden aparece en UN cubo y en uno solo", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    const cubos = cubosDelDia(filas, D);
    expect(cubos.get("entregada")?.n).toBe(1);
    expect(cubos.get("devuelta_a_tienda")?.n).toBe(2);
    expect(cubos.get("incidente")?.n).toBe(1);
    expect(cubos.get("viva")?.n).toBe(3);
    // Siete ordenes vivas en la cohorte (la octava esta borrada) y ni una contada dos veces.
    expect(cargadasDe(filas, D)).toBe(7);
  });

  it("una orden borrada no esta en ningun cubo", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // La borrada tiene transicion a `entregada`: sin el soft delete, `entregada` valdria 2.
    expect(cubosDelDia(filas, D).get("entregada")?.n).toBe(1);
    expect(cargadasDe(filas, D)).toBe(7);
  });

  it("la ultima GESTION vigente no decide el cubo: lo decide la transicion", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // La orden `gestion-dice-entregada` tiene una gestion vigente con resultado `entregada` y su
    // ultima transicion es `devuelta_a_tienda`. Si el desenlace saliera de la gestion —como hace
    // el anillo de la seccion de al lado—, `entregada` valdria 2 y `devuelta_a_tienda` 1.
    const cubos = cubosDelDia(filas, D);
    expect(cubos.get("entregada")?.n).toBe(1);
    expect(cubos.get("devuelta_a_tienda")?.n).toBe(2);
  });
});
