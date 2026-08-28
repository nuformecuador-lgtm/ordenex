import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑ FICHA 312 (B3 + G3) — LA CORRECCION DE LOS DATOS DEL CLIENTE, CONTRA POSTGRES REAL.
 *
 * POR QUE AQUI Y NO CON DOBLES:
 *
 *  · **LA VENTANA VIVE EN EL `WHERE`.** El bloqueo por estado no es un `if` del servicio: es
 *    `estatus.value NOT IN (...)` dentro de la MISMA sentencia que muta. Los tests de servicio
 *    usan dobles y NO VEN EL SQL: una mutacion que borre el `notIn` los deja a todos en verde.
 *    Medido en este repo cuatro veces seguidas. La ventana se prueba donde vive.
 *  · **R14 ES UNA AUSENCIA.** «No se escribe en ninguna otra tabla» solo se puede afirmar
 *    CONTANDO FILAS antes y despues. Un doble no tiene filas que contar. Este es el caso que mide
 *    D4: la ausencia de rastro se COMPRUEBA, no se supone.
 *  · **R5 ES OTRA AUSENCIA**, y la mas ancha: «no cambia ningun otro dato de la orden» se afirma
 *    comparando la fila entera antes y despues, no enumerando a mano las columnas que uno recuerda.
 *  · **R6 y R17 son hechos del MOTOR**: que la columna acepte 5.000 caracteres y que guarde
 *    `8888-9999` y no `50688889999` lo dice la base, no el codigo que la llama.
 *
 * ⚠️ NADA DE `if (!fks) return;`: con base y sin catalogo esto REVIENTA con un mensaje que dice
 * que hacer. Sin base, `describe.skip` visible. Todo dentro de una transaccion que se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `312-repo-${Date.now().toString(36)}`;
const GUIA_BASE = 941_000_000 + (Date.now() % 40_000_000);

/** Una marca ANTIGUA y explicita: `updated_at` tiene que dejarla atras al corregir (R15). */
const SEMBRADO_AT = new Date("2026-01-01T00:00:00.000Z");

const ORIGINAL = {
  destinatario: "Ana Peres",
  telefonoDest: "8888-7777",
  producto: "caja de zapatos",
  notas: "dejar en porteria",
} as const;

const CORREGIDO = {
  destinatario: "Ana Perez",
  telefonoDest: "8888-9999",
  producto: "caja de botas",
  notas: "llamar antes de llegar",
} as const;

/** Las columnas de `orden` que la ficha PUEDE cambiar, mas la marca de modificacion. */
const COLUMNAS_ESPERADAS = ["destinatario", "telefonoDest", "producto", "notas", "updatedAt"];

describeSiHayBase("⭑ 312/B3 — corregirDatosCliente contra Postgres real", () => {
  let prisma: PrismaClient;
  let ESTATUS: Record<string, string>;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;

    const valores = ["en_reparto", "devuelta", "ayuda_tienda", ...ESTADOS_SIN_CORRECCION];
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: valores } },
      select: { id: true, value: true },
    });
    ESTATUS = Object.fromEntries(estados.map((e) => [e.value, e.id]));
    const faltan = valores.filter((v) => !ESTATUS[v]);
    if (faltan.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltan.join(", ")}. Corre el seed del catalogo.`,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Siembra UNA orden con los valores ORIGINAL y ejecuta `fn`. Todo se revierte. */
  async function conOrden<T>(
    opciones: { estatusValue?: string; borrada?: boolean; producto?: string },
    fn: (ctx: { repo: OrdenRepository; tx: PrismaClient; ordenId: string }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 10)}`,
          ...ORIGINAL,
          producto: opciones.producto ?? ORIGINAL.producto,
          estatusId: ESTATUS[opciones.estatusValue ?? "en_reparto"],
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          direccion: "avenida siempre viva 742",
          intentosContacto: 2, // un valor DISTINGUIBLE: si algo lo tocara, se veria
          deletedAt: opciones.borrada === true ? new Date() : null,
          createdAt: SEMBRADO_AT,
          updatedAt: SEMBRADO_AT,
        },
        select: { id: true },
      });
      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return fn({ repo, tx: tx as unknown as PrismaClient, ordenId: orden.id });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* CASO 1 — el camino feliz: las cuatro columnas cambian                    */
  /* ---------------------------------------------------------------------- */

  it("⭑ caso 1: orden en `en_reparto` -> `ok` y las CUATRO columnas cambian", async () => {
    const r = await conOrden({}, async (ctx) => {
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        CORREGIDO,
        ESTADOS_SIN_CORRECCION,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { destinatario: true, telefonoDest: true, producto: true, notas: true },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toBe("ok");
    expect(r.fila).toEqual(CORREGIDO);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 2 — los cuatro estados bloqueados (R11, R13)                        */
  /* ---------------------------------------------------------------------- */

  it.each([...ESTADOS_SIN_CORRECCION])(
    "⭑ caso 2: orden en `%s` -> `conflict` y CERO columnas cambiadas",
    async (estatusValue) => {
      // Es el `WHERE` el que recorta, no un `if`: por eso se ejerce el repositorio DIRECTAMENTE,
      // sin el servicio de por medio. Quitar el `notIn` del `where` pone rojo este caso.
      const r = await conOrden({ estatusValue }, async (ctx) => {
        const resultado = await ctx.repo.corregirDatosCliente(
          ctx.ordenId,
          CORREGIDO,
          ESTADOS_SIN_CORRECCION,
        );
        const fila = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ordenId },
          select: {
            destinatario: true,
            telefonoDest: true,
            producto: true,
            notas: true,
            updatedAt: true,
          },
        });
        return { resultado, fila };
      });

      expect(r.resultado).toBe("conflict");
      expect({
        destinatario: r.fila.destinatario,
        telefonoDest: r.fila.telefonoDest,
        producto: r.fila.producto,
        notas: r.fila.notas,
      }).toEqual(ORIGINAL);
      // Ni siquiera la marca de modificacion: la sentencia no alcanzo la fila.
      expect(r.fila.updatedAt.toISOString()).toBe(SEMBRADO_AT.toISOString());
    },
  );

  /* ---------------------------------------------------------------------- */
  /* CASO 3 — la borrada logicamente (R12)                                    */
  /* ---------------------------------------------------------------------- */

  it("⭑ caso 3: orden con `deleted_at` -> `conflict`, sin efectos", async () => {
    // Quitar el `deletedAt: null` del `where` pone rojo este caso.
    const r = await conOrden({ borrada: true }, async (ctx) => {
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        CORREGIDO,
        ESTADOS_SIN_CORRECCION,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { destinatario: true, telefonoDest: true, producto: true, notas: true },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toBe("conflict");
    expect(r.fila).toEqual(ORIGINAL);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 4 — R14: LA AUSENCIA DE RASTRO, CONTADA                             */
  /* ---------------------------------------------------------------------- */

  it("⭑ caso 4 (R14/D4): corregir NO añade filas a `orden_historial_estado` NI a `orden_nota`", async () => {
    // ESTE caso ES la medicion de D4 (decision humana del 2026-08-28: la correccion no deja
    // ningun rastro). Un requisito negativo sin test es indistinguible de un olvido.
    const r = await conOrden({}, async (ctx) => {
      const [historialAntes, notasAntes] = await Promise.all([
        ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.ordenNota.count({ where: { ordenId: ctx.ordenId } }),
      ]);
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        CORREGIDO,
        ESTADOS_SIN_CORRECCION,
      );
      const [historialDespues, notasDespues] = await Promise.all([
        ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.ordenNota.count({ where: { ordenId: ctx.ordenId } }),
      ]);
      return { resultado, historialAntes, historialDespues, notasAntes, notasDespues };
    });

    // Anti-vacuidad: si la escritura no hubiera ocurrido, contar ceros no probaria nada.
    expect(r.resultado).toBe("ok");
    expect(r.historialDespues).toBe(r.historialAntes);
    expect(r.notasDespues).toBe(r.notasAntes);
  });

  it("⭑ caso 4bis (R14): tampoco aparece ninguna fila de chat ni de gestion", async () => {
    // Las otras dos tablas que un «rastro» habria tocado: el hilo de WhatsApp (R19) y la gestion.
    const r = await conOrden({}, async (ctx) => {
      const antes = await Promise.all([
        ctx.tx.chatConversacion.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.ordenDiaRepartoCambio.count({ where: { ordenId: ctx.ordenId } }),
      ]);
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        CORREGIDO,
        ESTADOS_SIN_CORRECCION,
      );
      const despues = await Promise.all([
        ctx.tx.chatConversacion.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
        ctx.tx.ordenDiaRepartoCambio.count({ where: { ordenId: ctx.ordenId } }),
      ]);
      return { resultado, antes, despues };
    });

    expect(r.resultado).toBe("ok");
    expect(r.despues).toEqual(r.antes);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 5 — R5/R15: la fila entera, antes y despues                         */
  /* ---------------------------------------------------------------------- */

  it("⭑ caso 5 (R5/R15): cambian SOLO las cuatro columnas y `updated_at`, y `updated_at` SI cambia", async () => {
    // No se enumeran a mano las columnas que uno recuerda: se comparan las DOS filas enteras y se
    // exige que el conjunto de diferencias sea exactamente el esperado. Asi, una columna nueva en
    // `orden` entra sola en la comprobacion.
    //
    // `busqueda_texto` no aparece: es una columna GENERADA por Postgres a partir de guia,
    // remision, telefono, destinatario y producto, y el cliente la OMITE globalmente
    // (`PRISMA_OMIT`). Que se recalcule sola no es una escritura de esta ficha.
    const r = await conOrden({}, async (ctx) => {
      const antes = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        CORREGIDO,
        ESTADOS_SIN_CORRECCION,
      );
      const despues = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      return { resultado, antes, despues };
    });

    expect(r.resultado).toBe("ok");

    const claves = Object.keys(r.antes);
    // Anti-vacuidad: si la proyeccion trajera dos columnas, "solo cambian estas cinco" no diria nada.
    expect(claves.length).toBeGreaterThan(25);
    const diferentes = claves.filter(
      (k) =>
        JSON.stringify((r.antes as Record<string, unknown>)[k]) !==
        JSON.stringify((r.despues as Record<string, unknown>)[k]),
    );
    expect(diferentes.sort()).toEqual([...COLUMNAS_ESPERADAS].sort());

    // R15: el UNICO rastro que esta ficha deja, y deja de verdad.
    expect(r.despues.updatedAt.getTime()).toBeGreaterThan(SEMBRADO_AT.getTime());
    // Y no se toco el estado ni la direccion, que son los dos con efectos colaterales en `update`.
    expect(r.despues.estatusId).toBe(r.antes.estatusId);
    expect(r.despues.direccion).toBe("avenida siempre viva 742");
    expect(r.despues.intentosContacto).toBe(2);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 6 — R6: sin tope de longitud tampoco en la base                     */
  /* ---------------------------------------------------------------------- */

  it("⭑ caso 6 (R6): un `producto` de 5.000 caracteres se guarda INTEGRO", async () => {
    const largo = "x".repeat(5_000);
    const r = await conOrden({}, async (ctx) => {
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { producto: largo, notas: largo },
        ESTADOS_SIN_CORRECCION,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { producto: true, notas: true },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toBe("ok");
    expect(r.fila.producto).toHaveLength(5_000);
    expect(r.fila.notas).toHaveLength(5_000);
    expect(r.fila.producto).toBe(largo);
  });

  /* ---------------------------------------------------------------------- */
  /* G3 — R17: el telefono se guarda como lo guarda la carga                  */
  /* ---------------------------------------------------------------------- */

  it("⭑ G3 (R17): corregir con `\" 8888-9999 \"` guarda `8888-9999`, NO `50688889999`", async () => {
    // Va por el SERVICIO con el repositorio REAL, porque la normalizacion (`.trim()`) es suya y lo
    // que se mide es lo que acaba EN LA COLUMNA. T1 (2026-08-28): la carga masiva guarda texto
    // recortado, no E.164; canonizar solo desde esta superficie dejaria la columna con dos
    // formatos segun por donde entro el dato.
    const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
    const r = await conOrden({}, async (ctx) => {
      const service = new CorregirDatosClienteService(ctx.repo);
      const resultado = await service.corregir(
        { ordenId: ctx.ordenId, telefonoDest: " 8888-9999 " },
        MAESTRO,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { telefonoDest: true, destinatario: true },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toEqual({ status: "ok", cambios: ["telefonoDest"] });
    expect(r.fila.telefonoDest).toBe("8888-9999");
    expect(r.fila.telefonoDest).not.toBe("50688889999");
    expect(r.fila.destinatario).toBe(ORIGINAL.destinatario); // nada mas se movio
  });

  it("⭑ el servicio completo, contra la base: un estado bloqueado no escribe NADA", async () => {
    // El camino de produccion entero (servicio + repositorio real) sobre la ventana de D3.
    const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
    const r = await conOrden({ estatusValue: "entregada" }, async (ctx) => {
      const service = new CorregirDatosClienteService(ctx.repo);
      const resultado = await service.corregir(
        { ordenId: ctx.ordenId, destinatario: CORREGIDO.destinatario },
        MAESTRO,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { destinatario: true, updatedAt: true },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toEqual({ status: "forbidden" });
    expect(r.fila.destinatario).toBe(ORIGINAL.destinatario);
    expect(r.fila.updatedAt.toISOString()).toBe(SEMBRADO_AT.toISOString());
  });
});
