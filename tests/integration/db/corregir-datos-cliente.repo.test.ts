import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
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
      // Ficha 327: `corregirDatosCliente` abre su propia transaccion (el encolado del job de
      // geocodificacion tiene que compartirla con la escritura). `Prisma.TransactionClient` no
      // expone `$transaction`, asi que se envuelve como pass-through SOBRE LA MISMA tx: el SQL
      // que se mide sigue siendo el real.
      const cliente = clienteConTransaccionAnidada(tx);
      const repo = new OrdenRepository(cliente);
      return fn({ repo, tx: cliente, ordenId: orden.id });
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

  it("⭑ caso 5 (R5/R15): cambian SOLO las columnas corregidas y `updated_at`, y `updated_at` SI cambia", async () => {
    // ⚠️ ENUNCIADO GENERALIZADO POR LA FICHA 327 (design §8.2). Decia «las CUATRO columnas»; la
    // regla vigente es «las columnas EFECTIVAMENTE corregidas, mas `zona_id` si la ubicacion
    // cambia, mas `updated_at`». Este caso corrige los cuatro de la 312, asi que su conjunto
    // esperado no se mueve — y el caso 327 de mas abajo mide el conjunto ampliado.
    //
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
      const service = new CorregirDatosClienteService(ctx.repo, new TarifaVigenteRepository(ctx.tx));
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
      const service = new CorregirDatosClienteService(ctx.repo, new TarifaVigenteRepository(ctx.tx));
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

  /* ====================================================================== */
  /* FICHA 327 / B5 — LA UBICACION, CONTRA POSTGRES                         */
  /* ====================================================================== */

  /**
   * Siembra el catalogo geografico que estos casos necesitan, DENTRO de la transaccion que se
   * revierte: dos zonas y cuatro distritos que cubren las tres respuestas del colapso de la N:M.
   *
   * Se crea a mano y no se busca en la base sembrada a proposito: un distrito con 2 zonas o con 0
   * no tiene por que existir en los datos reales, y un test que dependa de que exista se salta
   * solo el dia que alguien limpie el catalogo.
   */
  async function sembrarGeografia(tx: PrismaClient, sufijo: string) {
    // ⚠️ `esCentral: true` NO se puede sembrar a voluntad: `zona` tiene un indice UNICO PARCIAL que
    // admite UNA sola zona central en toda la base (feature 54). Se REUTILIZA la que ya exista y
    // solo se crea si no hay ninguna. Medido: crear una segunda revienta con «unique constraint».
    const zonaCentral =
      (await tx.zona.findFirst({ where: { esCentral: true }, select: { id: true } })) ??
      (await tx.zona.create({
        data: { nombre: `Z-327-central-${sufijo}`, esCentral: true },
        select: { id: true },
      }));
    // La zona de DESTINO se crea siempre: asi se garantiza que es DISTINTA de la de la orden.
    const zonaDestino = await tx.zona.create({
      data: { nombre: `Z-327-destino-${sufijo}`, esCentral: false },
      select: { id: true, nombre: true },
    });
    const zonaExtra = await tx.zona.create({
      data: { nombre: `Z-327-extra-${sufijo}`, esCentral: false },
      select: { id: true },
    });
    const crearDistrito = async (
      nombre: string,
      zonas: string[],
      zonaEspecial = false,
    ): Promise<string> => {
      const d = await tx.distrito.create({
        data: {
          nombre: `${nombre}-${sufijo}`,
          cantonId: FKS.cantonId,
          zonaEspecial,
          zonas: { create: zonas.map((zonaId) => ({ zonaId })) },
        },
        select: { id: true },
      });
      return d.id;
    };
    return {
      zonaDestinoId: zonaDestino.id,
      zonaDestinoNombre: zonaDestino.nombre,
      // El distrito de ORIGEN de la orden: cuelga de la zona con la que se siembra la fila.
      origen: await crearDistrito("D-origen", [FKS.zonaId]),
      // EXACTAMENTE una zona -> resuelve.
      unaZona: await crearDistrito("D-una-zona", [zonaDestino.id]),
      // CERO zonas -> no resuelve.
      sinZona: await crearDistrito("D-sin-zona", []),
      // DOS zonas -> ambiguo, tampoco resuelve.
      dosZonas: await crearDistrito("D-dos-zonas", [zonaDestino.id, zonaExtra.id]),
      // Especial, con UNA zona: la marca es del distrito, no de su zona.
      especial: await crearDistrito("D-especial", [zonaDestino.id], true),
      // Colgado de la zona CENTRAL: comprueba que `esCentral` viaja de la ZONA, no del distrito.
      enZonaCentral: await crearDistrito("D-central", [zonaCentral.id]),
    };
  }

  /** Una orden sembrada CON distrito, para poder moverla. Todo se revierte. */
  async function conOrdenUbicada<T>(
    opciones: { estatusValue?: string; borrada?: boolean },
    fn: (ctx: {
      repo: OrdenRepository;
      tx: PrismaClient;
      ordenId: string;
      geo: Awaited<ReturnType<typeof sembrarGeografia>>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (txCrudo) => {
      await serializarEscriturasReales(txCrudo);
      const tx = clienteConTransaccionAnidada(txCrudo);
      const sufijo = Math.random().toString(36).slice(2, 10);
      const geo = await sembrarGeografia(tx, sufijo);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${SUFIJO}-${sufijo}`,
          ...ORIGINAL,
          estatusId: ESTATUS[opciones.estatusValue ?? "en_reparto"],
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          distritoId: geo.origen,
          direccion: "avenida siempre viva 742",
          peso: "1.500",
          // Coordenadas SEMBRADAS: R22 exige que la correccion no las toque.
          latitud: "9.9281",
          longitud: "-84.0907",
          geocodedAt: SEMBRADO_AT,
          geocodePrecision: "ROOFTOP",
          geocodeStatus: "OK",
          intentosContacto: 2,
          deletedAt: opciones.borrada === true ? new Date() : null,
          createdAt: SEMBRADO_AT,
          updatedAt: SEMBRADO_AT,
        },
        select: { id: true },
      });
      return fn({ repo: new OrdenRepository(tx), tx, ordenId: orden.id, geo });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* CASO 327-1 y 327-2 — el camino feliz por el SERVICIO (R1, R8, R15, R5)  */
  /* ---------------------------------------------------------------------- */

  it("⭑ 327 caso 1+2 (R1/R8/R5/R15): los nueve campos se guardan RECORTADOS y `zona_id` es la DERIVADA", async () => {
    // Va por el SERVICIO con el repositorio REAL: el recorte es suyo, y la zona la deriva el. Lo
    // que se mide es lo que acaba EN LAS COLUMNAS.
    const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
    const r = await conOrdenUbicada({}, async (ctx) => {
      const service = new CorregirDatosClienteService(
        ctx.repo,
        new TarifaVigenteRepository(ctx.tx),
      );
      const resultado = await service.corregir(
        {
          ordenId: ctx.ordenId,
          destinatario: "  Ana Perez  ",
          telefonoDest: " 8888-9999 ",
          producto: " caja de botas ",
          notas: "  llamar antes  ",
          direccion: "   calle nueva 10   ",
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          distritoId: ctx.geo.unaZona,
          peso: 4.25,
          confirmaCambioDeUbicacion: true,
        },
        MAESTRO,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: {
          destinatario: true,
          telefonoDest: true,
          producto: true,
          notas: true,
          direccion: true,
          peso: true,
          provinciaId: true,
          cantonId: true,
          distritoId: true,
          zonaId: true,
        },
      });
      return { resultado, fila, geo: ctx.geo };
    });

    expect(r.resultado.status).toBe("ok");
    // R8: guardado con el MISMO tratamiento que la carga masiva (recortado).
    expect(r.fila.direccion).toBe("calle nueva 10");
    expect(r.fila.destinatario).toBe("Ana Perez");
    expect(r.fila.telefonoDest).toBe("8888-9999");
    expect(r.fila.producto).toBe("caja de botas");
    expect(r.fila.notas).toBe("llamar antes");
    expect(r.fila.peso?.toString()).toBe("4.25");
    expect(r.fila.distritoId).toBe(r.geo.unaZona);
    // R5/R15 — LA ZONA ES LA DERIVADA DEL DISTRITO, no la anterior ni ninguna venida de fuera.
    expect(r.fila.zonaId).toBe(r.geo.zonaDestinoId);
    expect(r.fila.zonaId).not.toBe(FKS.zonaId);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 327-3 y 327-4 — la fila entera, y las coordenadas intactas          */
  /* ---------------------------------------------------------------------- */

  it("⭑ 327 caso 3+4 (R1/R22): cambian SOLO las columnas corregidas + `zona_id` + `updated_at`, y las COORDENADAS no", async () => {
    const r = await conOrdenUbicada({}, async (ctx) => {
      const antes = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        {
          direccion: "calle nueva 10",
          distritoId: ctx.geo.unaZona,
          zonaId: ctx.geo.zonaDestinoId,
          peso: 4.25,
        },
        ESTADOS_SIN_CORRECCION,
      );
      const despues = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      return { resultado, antes, despues };
    });

    expect(r.resultado).toBe("ok");

    const claves = Object.keys(r.antes);
    // Anti-vacuidad: si la proyeccion trajera dos columnas, «solo cambian estas» no diria nada.
    expect(claves.length).toBeGreaterThan(25);
    const diferentes = claves.filter(
      (k) =>
        JSON.stringify((r.antes as Record<string, unknown>)[k]) !==
        JSON.stringify((r.despues as Record<string, unknown>)[k]),
    );
    expect(diferentes.sort()).toEqual(
      ["direccion", "distritoId", "peso", "updatedAt", "zonaId"].sort(),
    );

    // R22 — las escribe el trabajo de geocodificacion, no esta ficha. Se afirma aparte del
    // conjunto de arriba porque es EL requisito que un `latitud: null` «por limpiar» romperia.
    expect(r.despues.latitud?.toString()).toBe("9.9281");
    expect(r.despues.longitud?.toString()).toBe("-84.0907");
    expect(r.despues.geocodedAt?.toISOString()).toBe(SEMBRADO_AT.toISOString());
    expect(r.despues.geocodePrecision).toBe("ROOFTOP");
    expect(r.despues.geocodeStatus).toBe("OK");
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 327-5 — R17/R25: ni cierres, ni historial, ni notas                 */
  /* ---------------------------------------------------------------------- */

  it("⭑ 327 caso 5 (R17/R25): corregir la ubicacion no toca `cierre_detail`, ni historial, ni notas", async () => {
    const r = await conOrdenUbicada({}, async (ctx) => {
      // Se siembra un cierre CON su detalle de esta orden: sin fila congelada, «no cambio» no
      // probaria nada (un conteo de ceros pasa siempre).
      const cierre = await ctx.tx.cierreDia.create({
        data: {
          mensajero: { connect: { id: FKS.tiendaId } },
          estado: "solicitado",
          destinoTipo: "bodega_central",
          destinoZona: { connect: { id: FKS.zonaId } },
        },
        select: { id: true },
      });
      await ctx.tx.cierreDetail.create({
        data: {
          cierre: { connect: { id: cierre.id } },
          orden: { connect: { id: ctx.ordenId } },
          montoCobrar: "15000.00",
          cobraComision: true,
          zona: { connect: { id: FKS.zonaId } },
          tienda: { connect: { id: FKS.tiendaId } },
          esCentral: false,
          esZonaEspecial: false,
          numGuia: 1,
          numRemision: "R-congelada",
          destinatario: ORIGINAL.destinatario,
          direccion: "avenida siempre viva 742",
          producto: ORIGINAL.producto,
          tiendaNombre: "Tienda",
          zonaNombre: "Zona vieja",
          provinciaNombre: "Prov",
          cantonNombre: "Canton",
          distritoNombre: "Distrito viejo",
        },
      });

      const antes = {
        historial: await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
        notas: await ctx.tx.ordenNota.count({ where: { ordenId: ctx.ordenId } }),
        detalles: await ctx.tx.cierreDetail.findMany({ where: { ordenId: ctx.ordenId } }),
      };

      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { direccion: "calle nueva 10", distritoId: ctx.geo.unaZona, zonaId: ctx.geo.zonaDestinoId },
        ESTADOS_SIN_CORRECCION,
      );

      const despues = {
        historial: await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
        notas: await ctx.tx.ordenNota.count({ where: { ordenId: ctx.ordenId } }),
        detalles: await ctx.tx.cierreDetail.findMany({ where: { ordenId: ctx.ordenId } }),
      };
      return { resultado, antes, despues };
    });

    // Anti-vacuidad por partida doble: la escritura ocurrio Y habia una fila congelada que mirar.
    expect(r.resultado).toBe("ok");
    expect(r.antes.detalles).toHaveLength(1);

    expect(r.despues.historial).toBe(r.antes.historial);
    expect(r.despues.notas).toBe(r.antes.notas);
    // R17 — CAMPO A CAMPO, no solo el conteo: una fila «actualizada en sitio» tendria el mismo
    // conteo y otro contenido. La zona congelada sigue siendo la VIEJA: lo facturado no se mueve.
    expect(r.despues.detalles).toEqual(r.antes.detalles);
    expect(r.despues.detalles[0].zonaId).toBe(FKS.zonaId);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 327-6 — R29: la ventana y el borrado siguen recortando              */
  /* ---------------------------------------------------------------------- */

  it.each([...ESTADOS_SIN_CORRECCION])(
    "⭑ 327 caso 6 (R29): con la ubicacion, `%s` sigue siendo `conflict` y CERO columnas cambiadas",
    async (estatusValue) => {
      // Es el `WHERE` el que recorta, no un `if`: quitar el `notIn` pone rojo este caso. Se repite
      // con los campos NUEVOS porque la 327 mete la escritura dentro de una `$transaction`, y una
      // transaccion mal armada podria haberse llevado la ventana por delante.
      const r = await conOrdenUbicada({ estatusValue }, async (ctx) => {
        const antes = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
        const resultado = await ctx.repo.corregirDatosCliente(
          ctx.ordenId,
          {
            direccion: "calle nueva 10",
            distritoId: ctx.geo.unaZona,
            zonaId: ctx.geo.zonaDestinoId,
            peso: 4.25,
          },
          ESTADOS_SIN_CORRECCION,
        );
        const despues = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
        return { resultado, antes, despues };
      });

      expect(r.resultado).toBe("conflict");
      expect(r.despues).toEqual(r.antes);
      expect(r.despues.updatedAt.toISOString()).toBe(SEMBRADO_AT.toISOString());
    },
  );

  it("⭑ 327 caso 6bis (R29): la orden con `deleted_at` tampoco se mueve", async () => {
    const r = await conOrdenUbicada({ borrada: true }, async (ctx) => {
      const antes = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { direccion: "calle nueva 10", distritoId: ctx.geo.unaZona, zonaId: ctx.geo.zonaDestinoId },
        ESTADOS_SIN_CORRECCION,
      );
      const despues = await ctx.tx.orden.findUniqueOrThrow({ where: { id: ctx.ordenId } });
      return { resultado, antes, despues };
    });

    expect(r.resultado).toBe("conflict");
    expect(r.despues).toEqual(r.antes);
  });

  /* ---------------------------------------------------------------------- */
  /* CASO 327-7 — R7: el colapso de la N:M, contra la base                    */
  /* ---------------------------------------------------------------------- */

  it("⭑ 327 caso 7 (R7): el distrito resuelve UNA zona, o ninguna; nunca se inventa una", async () => {
    // Las TRES respuestas del colapso, medidas contra filas reales de `zona_distrito`. Que
    // `zonaUnicaDeDistrito` devolviera `zonas[0]` pondria rojo el caso de las dos zonas — y ese es
    // el bug que factura por la zona equivocada sin romper nada.
    const r = await conOrdenUbicada({}, async (ctx) => ({
      geo: ctx.geo,
      una: await ctx.repo.findDistritoParaCorreccion(ctx.geo.unaZona),
      sin: await ctx.repo.findDistritoParaCorreccion(ctx.geo.sinZona),
      dos: await ctx.repo.findDistritoParaCorreccion(ctx.geo.dosZonas),
      especial: await ctx.repo.findDistritoParaCorreccion(ctx.geo.especial),
      central: await ctx.repo.findDistritoParaCorreccion(ctx.geo.enZonaCentral),
      inexistente: await ctx.repo.findDistritoParaCorreccion(
        "00000000-0000-4000-8000-000000000000",
      ),
    }));

    // UNA zona -> esa, con su nombre y su `esCentral`.
    expect(r.una?.zonaId).toBe(r.geo.zonaDestinoId);
    expect(r.una?.zonaNombre).toBe(r.geo.zonaDestinoNombre);
    expect(r.una?.esCentral).toBe(false);
    expect(r.una?.esZonaEspecial).toBe(false);

    // `esCentral` viene de la ZONA (elige la columna GAM del flete), no del distrito: el mismo
    // tipo de distrito, colgado de la zona central, sale con `true`.
    expect(r.central?.esCentral).toBe(true);
    expect(r.central?.esZonaEspecial).toBe(false);
    // La cadena para R6 sale de la relacion, no de un segundo viaje.
    expect(r.una?.cantonId).toBe(FKS.cantonId);
    expect(r.una?.provinciaId).toBe(FKS.provinciaId);

    // CERO zonas -> `null`, y `esCentral` cae a `false` (no hay zona de la que sacarlo).
    expect(r.sin?.zonaId).toBeNull();
    expect(r.sin?.zonaNombre).toBeNull();
    expect(r.sin?.esCentral).toBe(false);

    // DOS zonas -> `null` TAMBIEN. No se elige la primera.
    expect(r.dos?.zonaId).toBeNull();
    expect(r.dos?.esCentral).toBe(false);

    // La marca especial es del DISTRITO y viaja aunque la zona sea la misma.
    expect(r.especial?.esZonaEspecial).toBe(true);
    expect(r.especial?.zonaId).toBe(r.geo.zonaDestinoId);

    // Y un id que no existe es `null`, no una excepcion.
    expect(r.inexistente).toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* R30 — `findParaCorreccion` no distingue borrada de inexistente           */
  /* ---------------------------------------------------------------------- */

  it("⭑ 327 (R30): `findParaCorreccion` devuelve `null` para la borrada y para la inexistente", async () => {
    const viva = await conOrdenUbicada({}, async (ctx) => ({
      fila: await ctx.repo.findParaCorreccion(ctx.ordenId),
      geo: ctx.geo,
    }));
    const borrada = await conOrdenUbicada({ borrada: true }, async (ctx) =>
      ctx.repo.findParaCorreccion(ctx.ordenId),
    );
    const inexistente = await conOrdenUbicada({}, async (ctx) =>
      ctx.repo.findParaCorreccion("00000000-0000-4000-8000-000000000000"),
    );

    // Anti-vacuidad: la viva SI sale, y sale con lo que el aviso necesita.
    expect(viva.fila?.direccion).toBe("avenida siempre viva 742");
    expect(viva.fila?.montoCobrar).toBeNull(); // la fila se siembra sin monto
    expect(viva.fila?.zonaId).toBe(FKS.zonaId);
    expect(viva.fila?.distritoId).toBe(viva.geo.origen);
    expect(viva.fila?.yaEnUnCierre).toBe(false);
    expect(viva.fila?.peso).toBe(1.5);

    expect(borrada).toBeNull();
    expect(inexistente).toBeNull();
  });
});
