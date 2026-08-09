import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import {
  FECHA_CR,
  VENTANA,
  crearGestion,
  crearOrden,
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

// Feature 192 (B8.4) — R57, R58, R60, R61.
//
// EL SEGUNDO CAMINO DE "ASIGNADA HOY" (decision humana del 2026-08-08, opcion C). La feature
// 157 asigna recolecciones SIN estampar `orden.asignado_at`, a proposito: esa columna es el
// denominador del ranking del mensajero y estamparla bajaria su porcentaje —y con el su pago—
// para arreglar una pantalla de lectura (R59, alternativa 14). Asi que el tablero las pesca
// por el HISTORIAL.
//
// El riesgo del segundo camino no es que no encuentre nada: es que encuentre lo mismo DOS
// VECES. Por eso la union es de CONJUNTOS (`UNION`, no `UNION ALL`) y por eso cada caso de
// aqui vuelve a assertar la identidad de ocho sumandos de R25.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("tablero del dia — el camino de recoleccion (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function conteo(
    sembrar: (tx: TxDeTest, base: BaseSembrada) => Promise<void>,
  ): Promise<readonly FilaTableroDia[]> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrar(tx, base);
      const filas = await repositorio(tx).contarPorMensajero(VENTANA, { tipo: "global" });
      return filas.filter((f) => f.mensajeroNombre.endsWith("Prueba"));
    });
  }

  function identidad(filas: readonly FilaTableroDia[]): void {
    for (const f of filas) expect(f.asignadas).toBe(sumaDeLosOcho(f));
  }

  it("una orden con asignado_at NULL y transicion de recoleccion de HOY cuenta (R57)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "recoleccion-hoy",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
    });

    expect(filas).toHaveLength(1);
    // R61 — se clasifica con las MISMAS reglas: sin gestion vigente hoy y en `recolectando`,
    // cae en `sinRecoger`. El mensajero va camino de la tienda: esta trabajando.
    expect(filas[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(filas);
  });

  it("la misma transicion con fecha de AYER no cuenta hoy (R57/R65)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "recoleccion-ayer",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR("2001-06-14", "23:00"));
    });

    expect(filas).toEqual([]);
  });

  it("una transicion de OTRO origen_tipo del mismo dia no abre el camino (R65)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "otro-origen",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await tx.ordenHistorialEstado.create({
        data: {
          ordenId: orden,
          estatusDestinoId: base.estatus.get("en_reparto") as string,
          actorUsuarioId: base.maestro,
          origenTipo: "recoleccion",
          createdAt: instanteCR(FECHA_CR, "08:00"),
        },
      });
    });

    // El criterio pesca `asignacion_recoleccion` y solo eso: si pescara cualquier transicion,
    // el tablero se llenaria de ordenes que nadie asigno hoy.
    expect(filas).toEqual([]);
  });

  it("una orden alcanzable por los DOS caminos aporta exactamente 1 (R58)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "dos-caminos",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
    });

    expect(filas).toHaveLength(1);
    // Con `UNION ALL` esto valdria 2 y la identidad de R25 se romperia en silencio: los
    // totales superarian a las asignadas, que es el error de la rama A que el humano descarto.
    expect(filas[0]).toMatchObject({ asignadas: 1, enReparto: 1 });
    identidad(filas);
  });

  it("DOS transiciones de recoleccion de la misma orden el mismo dia siguen aportando 1 (R58)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "reasignada",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      // Una reasignacion de recoleccion genera una segunda fila de historial. Con un
      // `LEFT JOIN` al historial esto multiplicaria filas y `asignadas` contaria transiciones
      // en vez de ordenes (alternativa 17).
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "11:00"));
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "12:30"));
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(filas);
  });

  it("la orden cuenta para el MENSAJERO asignado, no para el maestro que la asigno (R60)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "actor-maestro",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      // El `actor_usuario_id` de la transicion es el MAESTRO. Agrupar por el pondria las
      // ordenes en la tarjeta de quien decide, no en la de quien reparte.
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].mensajeroNombre).toContain("Ana");
    expect(filas[0].mensajeroNombre).not.toContain("Maestro");
    identidad(filas);
  });

  it("una recoleccion YA gestionada hoy cuenta con su resultado, no en un bucket (R61)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "recoleccion-gestionada",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
      await crearGestion(tx, {
        ordenId: orden,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "14:00"),
      });
    });

    expect(filas[0]).toMatchObject({ asignadas: 1, entregadas: 1, sinRecoger: 0 });
    identidad(filas);
  });

  it("una orden recolectada que ya avanzo de estatus NO desaparece a mitad de jornada", async () => {
    // Es el motivo por el que el camino 2 NO se acota a las ordenes en `recolectando`
    // (design.md §5.ter): perder la orden al avanzar borraria el trabajo hecho justo cuando el
    // mensajero cumple, y rompería la identidad de R25 en la tarjeta.
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "ya-avanzo",
        estatus: "en_ruta_bodega_central",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
    });

    expect(filas[0]).toMatchObject({ asignadas: 1, otros: 1 });
    identidad(filas);
  });

  it("el recorte por zona tambien se aplica a las ordenes del camino de recoleccion (R6/R10)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const orden = await crearOrden(tx, base, {
        clave: "recoleccion-zona-b",
        estatus: "recolectando",
        zonaId: base.zonaB,
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));

      const repo = repositorio(tx);
      const mias = (filas: readonly FilaTableroDia[]) =>
        filas.filter((f) => f.mensajeroNombre.endsWith("Prueba"));
      return {
        deA: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaA })),
        deB: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaB })),
      };
    });

    // `ids_recoleccion` no puede filtrar por zona (no conoce la orden todavia): el `JOIN orden`
    // posterior es obligatorio, y es el que aplica el recorte una sola vez.
    expect(resultado.deA).toEqual([]);
    expect(resultado.deB).toHaveLength(1);
  });

  it("una recoleccion sin mensajero asignado no aparece en ninguna tarjeta (R60)", async () => {
    const filas = await conteo(async (tx, base) => {
      const orden = await crearOrden(tx, base, {
        clave: "recoleccion-sin-mensajero",
        estatus: "recolectando",
        mensajeroId: null,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));
    });

    // "Quitar mensajero" devuelve la orden a `por_recolectar_en_tienda` dejandola sin
    // mensajero: sale del tablero, porque no es trabajo parado de nadie.
    expect(filas).toEqual([]);
  });
});
