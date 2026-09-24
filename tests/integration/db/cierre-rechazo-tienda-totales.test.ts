import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { ICorteDiarioRepository } from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

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
 * FICHA 425 (B6, R5/R6/R7/R9/R19) — EL TEST DEL DINERO: los totales del cierre NO SE MUEVEN cuando
 * entra un rechazo de tienda. Contra Postgres y con el SERVICIO real.
 *
 * POR QUE EL SERVICIO Y NO `crearCierre` A PELO. Los seis totales los CALCULA
 * `CierreDiaService.solicitarCierre` (`computeTotales`, `derivarPagos`, `derivarIngresoBodega`) a
 * partir de lo que Postgres devuelve a `findGestionesPendientes`, y los CONGELA `crearCierre`. Si este
 * test pasara los totales a mano, compararia el resultado con su propia entrada y saldria verde
 * siempre. Aqui los calcula el codigo de produccion.
 *
 * EL MISMO ESCENARIO SE SIEMBRA DOS VECES —con el rechazo de tienda y sin el— y los seis totales se
 * comparan como STRING escala 2, entre si Y contra un literal. El literal importa: sin el, dos cierres
 * igual de rotos serian iguales entre si.
 *
 * EL ESCENARIO, y por que estas gestiones:
 *   - una ENTREGADA de calle con 12500.00 en efectivo: mueve `total_efectivo`, `total_general` y el
 *     pago al mensajero (tarifa sembrada: 1500.00 por entrega);
 *   - una RECHAZADA de calle del propio mensajero: mueve `total_ingreso_bodega_rechazos` (164.00, el
 *     `cobro_rechazado` medido en produccion);
 *   - [solo en «con»] un RECHAZO DE TIENDA, que TAMBIEN es `rechazada`. Si entrara al cierre como
 *     gestion, el ingreso de bodega saldria en 328.00 y no en 164.00: es el cobro de mas que la ficha
 *     existe para impedir, y este archivo se pondria rojo.
 *
 * LA TARIFA Y LA ZONA SE SIEMBRAN dentro de la transaccion (una zona nueva y su tarifa por defecto),
 * para que los importes no dependan de lo que la base local tenga capturado.
 *
 * Y EL CASO ARNEL: el cierre que nace SOLO con rechazos lo crea el CORTE real (la seleccion real,
 * recortada a este mensajero), y tiene que nacer con los seis totales en 0.00.
 *
 * Todo corre en transacciones que SIEMPRE se revierten. SIN base se SALTA; con base y sin catalogo,
 * falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f425t${Date.now().toString(36)}`;
const GUIA_BASE = 475_000_000 + (Date.now() % 50_000_000);

const TARIFA = { cobroEntregado: "1500.00", cobroRechazado: "164.00" } as const;
const RECAUDO_EFECTIVO = "12500.00";

/** No hay evidencias en estos cierres: el proveedor de URLs no se llega a usar. */
const URLS_NO_USADAS: ISignedUrlProvider = {
  createSignedUrl: async (ruta: string) => ruta,
  createSignedUrls: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, r])),
};

interface Totales {
  efectivo: string;
  simpe: string;
  transferencia: string;
  general: string;
  pagoMensajero: string;
  ingresoBodegaRechazos: string;
}

interface Medida {
  totales: Totales;
  sumaPagoConCierre: string;
  sumaIngresoConCierre: string;
  gestionesConCierre: number;
  contaminadas: number;
  vinculos: number;
  rechazoDeTienda: {
    cierreId: string | null;
    pagoMensajero: string | null;
    ingresoBodegaRechazo: string | null;
  } | null;
}

describeSiHayBase("425/B6 — los totales del cierre no se mueven cuando entra un rechazo de tienda", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  let estatus: Map<string, string>;
  let n = 0;

  let conRechazo: Medida;
  let sinRechazo: Medida;
  let soloRechazos: Medida & { sonda: unknown; vencidosCreados: number; estado: string };

  function idDe(value: string): string {
    const id = estatus.get(value);
    if (id === undefined) throw new Error(`falta el estatus «${value}» en \`order_status\``);
    return id;
  }

  async function sembrarMensajeroConTarifa(tx: TxDeTest): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const zona = await tx.zona.create({ data: { sinpeNumero: "80000000", sinpeNombre: "Titular de Prueba", nombre: `Zona 425 ${clave}` }, select: { id: true } });
    await tx.tarifaZonaMensajero.create({
      data: {
        zonaId: zona.id,
        vehiculoId: null,
        cobroEntregado: TARIFA.cobroEntregado,
        cobroRechazado: TARIFA.cobroRechazado,
      },
    });
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero 425 ${clave}`,
        email: `t425-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `T425${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
        zonaId: zona.id,
      },
      select: { id: true },
    });
    return u.id;
  }

  /** Una gestion SUELTA con su orden, su linea de pago (si es entrega) y su fila de historial. */
  async function sembrarGestion(
    tx: TxDeTest,
    mensajeroId: string,
    origenTipo: OrdenHistorialOrigenTipo,
    resultado: "entregado" | "devolucion_a_origen_por_rechazo",
  ): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const entregada = resultado === "entregado";
    const orden = await tx.orden.create({
      data: {
        numGuia: GUIA_BASE + n,
        numRemision: `R-${clave}`,
        destinatario: `Dest ${clave}`,
        telefonoDest: "88880000",
        producto: `Prod ${clave}`,
        estatusId: idDe(resultado),
        mensajeroAsignadoId: mensajeroId,
        montoCobrar: entregada ? RECAUDO_EFECTIVO : null,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId: orden.id,
        mensajeroId,
        resultado,
        cierreId: null,
        ...(entregada
          ? { montoRecibido: RECAUDO_EFECTIVO, metodoPago: "efectivo" as const }
          : { motivo: "No la recibe" }),
      },
      select: { id: true },
    });
    if (entregada) {
      await tx.gestionOrdenPago.create({
        data: { gestionId: gestion.id, metodo: "efectivo", monto: RECAUDO_EFECTIVO },
      });
    }
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId: orden.id,
        estatusOrigenId: null,
        estatusDestinoId: idDe(resultado),
        actorUsuarioId: null,
        origenTipo,
        gestionOrdenId: gestion.id,
      },
    });
    return gestion.id;
  }

  /** Los servicios REALES, todos sobre la transaccion del test. */
  function montar(tx: TxDeTest) {
    const cliente = clienteConTransaccionAnidada(tx);
    const cierreRepo = new CierreDiaRepository(cliente, new TarifaVigenteRepository(cliente));
    const zonaRepo = new ZonaRepository(cliente);
    const ordenRepo = new OrdenRepository(cliente);
    const tarifaZonaRepo = new TarifaZonaMensajeroRepository(cliente);
    const corteReal = new CorteDiarioRepository(cliente);
    return {
      mensajero: new CierreDiaService(cierreRepo, zonaRepo, ordenRepo, URLS_NO_USADAS, tarifaZonaRepo),
      corteDe: (mensajeroId: string) =>
        new CorteDiarioService(
          {
            // La seleccion REAL, recortada a ESTE mensajero: el corte sobre la base local compartida
            // no tiene por que crear cierres a nadie mas (y todo se revierte igual).
            findMensajerosConActividadSinCierre: async (dia: Date) =>
              (await corteReal.findMensajerosConActividadSinCierre(dia)).filter(
                (m) => m.mensajeroId === mensajeroId,
              ),
          } as ICorteDiarioRepository,
          cierreRepo,
          zonaRepo,
          ordenRepo,
          tarifaZonaRepo,
          { warn: () => {} },
        ),
    };
  }

  async function leerCierre(tx: TxDeTest, cierreId: string, rechazoId: string | null): Promise<Medida> {
    const c = await tx.cierreDia.findUniqueOrThrow({
      where: { id: cierreId },
      select: {
        totalEfectivo: true,
        totalSimpe: true,
        totalTransferencia: true,
        totalGeneral: true,
        totalPagoMensajero: true,
        totalIngresoBodegaRechazos: true,
      },
    });
    // M1/M2: lo que SUMAN las gestiones con `cierre_id`, calculado por Postgres y no por el test.
    const [suma] = await tx.$queryRawUnsafe<{ pago: string; ingreso: string; n: number }[]>(
      `SELECT coalesce(sum(pago_mensajero), 0)::numeric(12,2)::text AS pago,
              coalesce(sum(ingreso_bodega_rechazo), 0)::numeric(12,2)::text AS ingreso,
              count(*)::int AS n
         FROM gestion_orden WHERE cierre_id = $1`,
      cierreId,
    );
    // design §8, M1/M2 «despues»: una gestion vinculada como rechazo no puede tener dinero ni cierre.
    const [contaminacion] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM gestion_orden g
         JOIN cierre_rechazo_tienda v ON v.gestion_id = g.id
        WHERE v.cierre_id = $1
          AND (g.cierre_id IS NOT NULL OR g.ingreso_bodega_rechazo IS NOT NULL
               OR g.pago_mensajero IS NOT NULL)`,
      cierreId,
    );
    const rechazo =
      rechazoId === null
        ? null
        : await tx.gestionOrden.findUniqueOrThrow({
            where: { id: rechazoId },
            select: { cierreId: true, pagoMensajero: true, ingresoBodegaRechazo: true },
          });
    return {
      totales: {
        efectivo: c.totalEfectivo.toFixed(2),
        simpe: c.totalSimpe.toFixed(2),
        transferencia: c.totalTransferencia.toFixed(2),
        general: c.totalGeneral.toFixed(2),
        pagoMensajero: c.totalPagoMensajero.toFixed(2),
        ingresoBodegaRechazos: c.totalIngresoBodegaRechazos.toFixed(2),
      },
      sumaPagoConCierre: suma.pago,
      sumaIngresoConCierre: suma.ingreso,
      gestionesConCierre: suma.n,
      contaminadas: contaminacion.n,
      vinculos: await tx.cierreRechazoTienda.count({ where: { cierreId } }),
      rechazoDeTienda:
        rechazo === null
          ? null
          : {
              cierreId: rechazo.cierreId,
              pagoMensajero: rechazo.pagoMensajero?.toFixed(2) ?? null,
              ingresoBodegaRechazo: rechazo.ingresoBodegaRechazo?.toFixed(2) ?? null,
            },
    };
  }

  function medir(conRechazoDeTienda: boolean): Promise<Medida> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await sembrarMensajeroConTarifa(tx);
      await sembrarGestion(tx, mensajeroId, "gestion", "entregado");
      await sembrarGestion(tx, mensajeroId, "gestion", "devolucion_a_origen_por_rechazo");
      const rechazoId = conRechazoDeTienda
        ? await sembrarGestion(tx, mensajeroId, "rechazo_tienda", "devolucion_a_origen_por_rechazo")
        : null;
      const r = await montar(tx).mensajero.solicitarCierre({ usuarioId: mensajeroId, rol: "mensajero" });
      if (r.status !== "ok" || r.via !== "creado") {
        throw new Error(`solicitarCierre no creo el cierre: ${JSON.stringify(r)}`);
      }
      if (r.cierreId === undefined) throw new Error("solicitarCierre respondio `creado` sin cierreId");
      return leerCierre(tx, r.cierreId, rechazoId);
    });
  }

  function medirSoloRechazos() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await sembrarMensajeroConTarifa(tx);
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(await sembrarGestion(tx, mensajeroId, "rechazo_tienda", "devolucion_a_origen_por_rechazo"));
      }
      const ctx = montar(tx);
      // SONDA, no requisito: el mensajero NO puede pedir el mismo un cierre que solo trae rechazos
      // (`solicitarCierre` no tiene gestiones pendientes que cerrar). La via del caso Arnel es el CORTE.
      const sonda = await ctx.mensajero.solicitarCierre({ usuarioId: mensajeroId, rol: "mensajero" });
      const corte = await ctx.corteDe(mensajeroId).ejecutarCorte(new Date());
      const cierre = await tx.cierreDia.findFirst({
        where: { mensajeroId },
        select: { id: true, estado: true },
      });
      if (cierre === null) {
        throw new Error(`el corte no creo el cierre del mensajero SOLO con rechazos: ${JSON.stringify(corte)}`);
      }
      const medida = await leerCierre(tx, cierre.id, ids[0]);
      return { ...medida, sonda, vencidosCreados: corte.vencidosCreados, estado: cierre.estado };
    });
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error("hay DATABASE_URL pero la tabla `orden` esta vacia: corre `pnpm run db:seed`.");
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) throw new Error("hace falta al menos UN usuario en la base.");
    fksUsuario = usuario;
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: ["entregado", "devolucion_a_origen_por_rechazo"] } },
      select: { id: true, value: true },
    });
    estatus = new Map(catalogo.map((c) => [c.value, c.id]));
    idDe("entregado");
    idDe("devolucion_a_origen_por_rechazo");

    conRechazo = await medir(true);
    sinRechazo = await medir(false);
    soloRechazos = await medirSoloRechazos();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R6/R7/R19: los SEIS totales son identicos al centimo con y sin el rechazo, y valen lo que tienen que valer", () => {
    const esperado: Totales = {
      efectivo: "12500.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12500.00",
      pagoMensajero: "1500.00",
      ingresoBodegaRechazos: "164.00",
    };
    expect(sinRechazo.totales).toEqual(esperado);
    expect(conRechazo.totales).toEqual(esperado);
  });

  it("R6 (M1/M2): total_pago_mensajero = Σ pago_mensajero de las gestiones CON cierre_id, con y sin rechazo", () => {
    for (const m of [sinRechazo, conRechazo]) {
      expect(m.sumaPagoConCierre).toBe(m.totales.pagoMensajero);
      expect(m.sumaIngresoConCierre).toBe(m.totales.ingresoBodegaRechazos);
      // Las dos de calle, y el rechazo de tienda NO.
      expect(m.gestionesConCierre).toBe(2);
    }
  });

  it("R9: la gestion del rechazo sigue con cierre_id, pago_mensajero e ingreso_bodega_rechazo en NULL", () => {
    expect(conRechazo.rechazoDeTienda).toEqual({
      cierreId: null,
      pagoMensajero: null,
      ingresoBodegaRechazo: null,
    });
  });

  it("design §8: la consulta de contaminacion devuelve 0, y el vinculo SI existe (no es verde por vacio)", () => {
    expect(conRechazo.vinculos).toBe(1);
    expect(conRechazo.contaminadas).toBe(0);
  });

  it("R19: sin rechazos no se escribe ni un vinculo de revision", () => {
    expect(sinRechazo.vinculos).toBe(0);
    expect(sinRechazo.contaminadas).toBe(0);
  });

  it("R5/R6/R7: el cierre que el corte crea SOLO con rechazos (caso Arnel) nace con los seis totales en 0.00", () => {
    expect(soloRechazos.sonda).toEqual({
      status: "conflict",
      motivo: "No tenes gestiones pendientes de cierre.",
    });
    expect(soloRechazos.vencidosCreados).toBe(1);
    expect(soloRechazos.estado).toBe("vencido");
    expect(soloRechazos.totales).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
      pagoMensajero: "0.00",
      ingresoBodegaRechazos: "0.00",
    });
    expect(soloRechazos.vinculos).toBe(3);
    expect(soloRechazos.gestionesConCierre).toBe(0);
    expect(soloRechazos.sumaPagoConCierre).toBe(soloRechazos.totales.pagoMensajero);
    expect(soloRechazos.contaminadas).toBe(0);
  });
});
