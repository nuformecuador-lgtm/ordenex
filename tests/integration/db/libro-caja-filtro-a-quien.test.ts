import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { listarMovimientosAction, listarMovimientosCompletoAction, listarMovimientosDeFilaAction, verResumenCajaAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { conceptosConMovimientosAction, quienesDelLibroCajaAction } from "@/lib/actions/wallet-filtros";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { LibroCajaAutoriaRepository } from "@/lib/repositories/LibroCajaAutoriaRepository";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import { LibroCajaAutoriaService } from "@/lib/services/LibroCajaAutoriaService";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";
import type { AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { AgregadoCajaRow, WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";
import { categoriasDeFilaComposicion, derivarCaja, derivarComposicionGanancia } from "@/lib/utils/caja-tesoreria";
import { fechaCalendarioCR, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-E / TE.2 (R59) — el filtro «A quién» del libro de la caja, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Escenario: la fase 0 de la 459 (todos los caminos que escriben en la caja, por sus servicios reales)
// + un pago de un gasto de una tienda, un aporte, un pago de la tienda B a Ordenex, la anotacion
// «Cartonera del Valle» sobre el gasto variable de hoy, otra correccion anotada «  cartonera DEL valle »
// FUERA del periodo de hoy y una anotada «Transportes Solano» hoy. Todo en una transaccion revertida.
//
// El ORACULO no es el codigo que se prueba: el conjunto esperado de cada «a quien» sale de la columna
// «A quién» del libro (`LibroCajaAutoriaService`, 458-B) leida fila a fila, y las sumas esperadas se
// hacen aqui con `Prisma.Decimal` sobre las filas que devolvio el libro. Lo que se afirma:
//   · el libro filtrado es EXACTAMENTE el conjunto de la columna «A quién» (tienda, mensajero, nombre);
//   · con los demas filtros (direccion, concepto, periodo) tambien, y en el orden total del libro;
//   · tarjetas + composicion + desglose + conceptos = Σ de las filas del libro filtrado;
//   · una cuenta ajena (sin filas) da 0 filas y todo en 0,00;
//   · el selector ofrece esas cuentas y nombres con el numero de filas del filtro, en el periodo.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Fila = {
  id: string;
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: string;
  fechaMovimiento: string;
};

interface Lectura {
  /** Ids del libro filtrado, en el orden en que los devolvio. */
  ids: string[];
  total: number;
  filas: Fila[];
  /** `verResumenCajaAction` con el mismo filtro. */
  resumen: unknown;
  composicion: unknown;
  /** Lo que la tarjeta DEBERIA decir, derivado de las filas del libro. */
  resumenDeLasFilas: unknown;
  composicionDeLasFilas: unknown;
  desglose: Record<string, string>;
  desgloseDeLasFilas: Record<string, string>;
  conceptos: { categoria: string; movimientos: number }[];
  conceptosDeLasFilas: { categoria: string; movimientos: number }[];
  descargaIds: string[];
}

interface Medida {
  esperado: Record<"tiendaA" | "tiendaB" | "mensajero" | "cartonera" | "solano", string[]>;
  lecturas: Record<"tiendaA" | "tiendaB" | "mensajero" | "cartonera" | "solano" | "ajena", Lectura>;
  /** Con los demas filtros: lo que devolvio el libro y lo esperado (conjunto y orden). */
  combinados: { nombre: string; obtenido: string[]; esperado: string[]; dtoIgual: boolean }[];
  /** El detalle de una fila de la composicion con «A quién». */
  deFila: { obtenido: string[]; esperado: string[] };
  opcionesTodo: { clase: string; nombre: string; valor: AQuienFiltro; movimientos: number }[];
  opcionesHoy: { clase: string; nombre: string; valor: AQuienFiltro; movimientos: number }[];
  opcionesBusqueda: { clase: string; nombre: string }[];
  opcionesTope: { n: number; hayMas: boolean; hayMasSinTope: boolean };
  nombres: { tiendaA: string; tiendaB: string; mensajero: string };
  ids: { tiendaA: string; tiendaB: string; mensajero: string };
  cuentaDeAutoria: Map<string, AutoriaDeFilaDTO>;
  bordes: Record<string, unknown>;
}

function claveCuenta(a: AutoriaDeFilaDTO): string | null {
  return a.aQuien.cuenta === null ? null : `${a.aQuien.cuenta.tipo}:${a.aQuien.cuenta.id}`;
}

/** Los grupos (categoria, tipo) de unas filas, sumados con `Decimal`: la entrada de `derivarCaja`. */
function agregado(filas: readonly Fila[]): AgregadoCajaRow[] {
  const porClave = new Map<string, { categoria: WalletMovimientoCategoria; tipo: WalletMovimientoTipo; total: Prisma.Decimal }>();
  for (const f of filas) {
    const k = `${f.categoria}|${f.tipo}`;
    const g = porClave.get(k) ?? { categoria: f.categoria, tipo: f.tipo, total: new Prisma.Decimal(0) };
    g.total = g.total.add(new Prisma.Decimal(f.monto));
    porClave.set(k, g);
  }
  return [...porClave.values()].map((g) => ({ categoria: g.categoria, tipo: g.tipo, total: g.total.toFixed(2) }));
}

function sumaDe(filas: readonly Fila[], categoria: WalletMovimientoCategoria): string {
  return filas
    .filter((f) => f.categoria === categoria)
    .reduce((acc, f) => acc.add(new Prisma.Decimal(f.monto)), new Prisma.Decimal(0))
    .toFixed(2);
}

describeSiHayBase("458-E/TE.2 — filtro «A quién» del libro de la caja (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const previos = new Set((await tx.walletMovimiento.findMany({ select: { id: true } })).map((x) => x.id));
        const esc = await sembrarEscenario459(tx, cat);
        const actor = esc.maestro;
        const hoy = fechaCalendarioCR(new Date());

        // ── Lo que se suma al escenario ───────────────────────────────────────────────────────
        const pago = await s.pagoPorCuenta.registrar(
          { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaA, beneficiario: "Imprenta Ruiz", monto: "100.00", metodo: "efectivo", motivo: "Etiquetas" },
          null,
          actor,
        );
        if (pago.status !== "ok") throw new Error(`pago por cuenta: ${JSON.stringify(pago)}`);
        const aporte = await s.aporteCapital.registrar(
          { claveIdempotencia: randomUUID(), clase: "aporte", monto: "50.00", fecha: hoy, motivo: "Aporte 458-E" },
          null,
          actor,
        );
        if (aporte.status !== "ok") throw new Error(`aporte: ${JSON.stringify(aporte)}`);
        // El pago de una tienda a Ordenex exige que la tienda DEBA (457/R14): antes, un cobro grande.
        const cobroGrande = await s.cobroTienda.registrarCobro(
          { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaB, monto: "20000.00", descripcion: "Cobro grande 458-E" },
          actor,
        );
        if (cobroGrande.status !== "ok") throw new Error(`cobro grande: ${JSON.stringify(cobroGrande)}`);
        const abono = await s.abonoTienda.registrar(
          { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaB, monto: "10.00", metodo: "SINPE", referencia: "SINPE-458E", motivo: "Abono 458-E", fechaPago: hoy },
          null,
          actor,
        );
        if (abono.status !== "ok") throw new Error(`abono: ${JSON.stringify(abono)}`);
        const gasto = await tx.walletMovimiento.findFirstOrThrow({
          where: { categoria: "egreso_gasto_variable", registradoPor: actor.usuarioId },
          select: { id: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: gasto.id, contraparteNombre: "Cartonera del Valle" } });
        // Una correccion anotada con el MISMO nombre escrito distinto, fuera del periodo de hoy.
        const fuera = await tx.walletMovimiento.create({
          data: {
            tipo: "ingreso",
            categoria: "ingreso_ajuste",
            monto: new Prisma.Decimal("7.00"),
            origenTipo: "manual",
            origenId: null,
            descripcion: "458-E: correccion fuera del periodo",
            registradoPor: actor.usuarioId,
            fechaMovimiento: new Date("2026-09-10T18:00:00.000Z"),
          },
          select: { id: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: fuera.id, contraparteNombre: "  cartonera DEL valle " } });
        const solano = await tx.walletMovimiento.create({
          data: {
            tipo: "egreso",
            categoria: "egreso_ajuste",
            monto: new Prisma.Decimal("3.00"),
            origenTipo: "manual",
            origenId: null,
            descripcion: "458-E: correccion de hoy",
            registradoPor: actor.usuarioId,
          },
          select: { id: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: solano.id, contraparteNombre: "Transportes Solano" } });

        // ── El oraculo: la columna «A quién» de cada fila nueva ───────────────────────────────
        const nuevas = (await tx.walletMovimiento.findMany({ select: { id: true } })).filter((x) => !previos.has(x.id)).map((x) => x.id);
        const autoriaSrv = new LibroCajaAutoriaService(new LibroCajaAutoriaRepository(s.cliente));
        const cuentaDeAutoria = new Map<string, AutoriaDeFilaDTO>();
        for (let i = 0; i < nuevas.length; i += 100) {
          const r = await autoriaSrv.resolver({ movimientoIds: nuevas.slice(i, i + 100) }, actor);
          if (r.status !== "ok") throw new Error(`autoria: ${r.status}`);
          for (const f of r.filas) cuentaDeAutoria.set(f.movimientoId, f);
        }
        const conCuenta = (clave: string) => nuevas.filter((id) => {
          const a = cuentaDeAutoria.get(id);
          return a !== undefined && claveCuenta(a) === clave;
        });
        const conNombre = (n: string) => nuevas.filter((id) => (cuentaDeAutoria.get(id)?.aQuien.nombre ?? "").trim().toLowerCase() === n);
        const esperado = {
          tiendaA: conCuenta(`tienda:${esc.tiendaA}`),
          tiendaB: conCuenta(`tienda:${esc.tiendaB}`),
          mensajero: conCuenta(`mensajero:${esc.mensajeroId}`),
          cartonera: conNombre("cartonera del valle"),
          solano: conNombre("transportes solano"),
        };

        // ── Los bordes, con el cliente de la transaccion ──────────────────────────────────────
        const origenes = new OrigenLegibleService(new OrigenLegibleRepository(s.cliente));
        const deps = { getActor: async () => actor, service: s.wallet, origenes };
        const depsEgresos = { getActor: async () => actor, service: s.egresos };
        const filtrosSrv = new FiltrosWalletService(new FiltrosWalletRepository(s.cliente));
        const depsFiltros = { getActor: async () => actor, service: filtrosSrv };

        async function leer(aQuien: AQuienFiltro): Promise<Lectura> {
          const libro = await listarMovimientosAction({ aQuien, page: 1, pageSize: 100 }, deps);
          if (libro.status !== "ok") throw new Error(`libro: ${JSON.stringify(libro)}`);
          if (libro.data.total > 100) throw new Error("el conjunto no cabe en una pagina: el test no lo veria entero");
          const filas: Fila[] = libro.data.movimientos.map((x) => ({
            id: x.id,
            tipo: x.tipo,
            categoria: x.categoria,
            monto: x.monto,
            fechaMovimiento: x.fechaMovimiento,
          }));
          const res = await verResumenCajaAction({ aQuien }, deps);
          if (res.status !== "ok") throw new Error(`resumen: ${JSON.stringify(res)}`);
          const des = await verDesgloseEgresosAction({ aQuien }, depsEgresos);
          if (des.status !== "ok") throw new Error(`desglose: ${JSON.stringify(des)}`);
          const con = await conceptosConMovimientosAction({ libro: "caja", aQuien }, depsFiltros);
          if (con.status !== "ok") throw new Error(`conceptos: ${JSON.stringify(con)}`);
          const descarga = await listarMovimientosCompletoAction({ aQuien }, deps);
          if (descarga.status !== "ok") throw new Error(`descarga: ${JSON.stringify(descarga)}`);
          const agr = agregado(filas);
          const porCategoria = new Map<string, number>();
          for (const f of filas) porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1);
          return {
            ids: filas.map((f) => f.id),
            total: libro.data.total,
            filas,
            resumen: res.resumen,
            composicion: res.composicion,
            // Mismas dos lecturas SIN filtro que hace el servicio (estado y primer dia) — no son dinero.
            resumenDeLasFilas: derivarCaja(agr, {
              periodoFiltrado: true,
              haySaldoInicialVigente: res.resumen.estado === "saldo",
              primerDia: res.resumen.flujoDesde,
            }),
            composicionDeLasFilas: derivarComposicionGanancia(agr),
            desglose: { ...des.desglose },
            desgloseDeLasFilas: {
              gastoFijo: sumaDe(filas, "egreso_gasto_fijo"),
              gastoVariable: sumaDe(filas, "egreso_gasto_variable"),
              sueldo: sumaDe(filas, "egreso_sueldo"),
              indemnizacion: sumaDe(filas, "egreso_indemnizacion"),
              total: [
                "egreso_gasto_fijo",
                "egreso_gasto_variable",
                "egreso_sueldo",
                "egreso_indemnizacion",
              ]
                .reduce((acc, c) => acc.add(new Prisma.Decimal(sumaDe(filas, c as WalletMovimientoCategoria))), new Prisma.Decimal(0))
                .toFixed(2),
            },
            conceptos: [...con.conceptos].sort((a, b) => a.categoria.localeCompare(b.categoria)),
            conceptosDeLasFilas: [...porCategoria]
              .map(([categoria, movimientos]) => ({ categoria, movimientos }))
              .sort((a, b) => a.categoria.localeCompare(b.categoria)),
            descargaIds: descarga.items.map((x) => x.id),
          };
        }

        const tiendaA: AQuienFiltro = { tipo: "tienda", id: esc.tiendaA };
        const lecturas = {
          tiendaA: await leer(tiendaA),
          tiendaB: await leer({ tipo: "tienda", id: esc.tiendaB }),
          mensajero: await leer({ tipo: "mensajero", id: esc.mensajeroId }),
          cartonera: await leer({ nombre: "CARTONERA del valle" }),
          solano: await leer({ nombre: "transportes solano" }),
          ajena: await leer({ tipo: "tienda", id: randomUUID() }),
        };

        // ── Con los demas filtros: el conjunto de la tienda A recortado a mano, y el orden del libro ─
        const filasA = await tx.walletMovimiento.findMany({
          where: { id: { in: esperado.tiendaA } },
          orderBy: [{ fechaMovimiento: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        });
        const dia = (d: string) => ({ desde: inicioDelDiaCREnUtc(d), hasta: inicioDelDiaSiguienteCREnUtc(d) });
        const categoriaDeA = filasA[0]?.categoria;
        const combos: { nombre: string; input: Record<string, unknown>; pasa: (f: (typeof filasA)[number]) => boolean }[] = [
          { nombre: "Sale", input: { tipo: "egreso" }, pasa: (f) => f.tipo === "egreso" },
          { nombre: "Entra", input: { tipo: "ingreso" }, pasa: (f) => f.tipo === "ingreso" },
          { nombre: "concepto", input: { categoria: categoriaDeA }, pasa: (f) => f.categoria === categoriaDeA },
          {
            nombre: "periodo de hoy",
            input: { desde: hoy, hasta: hoy },
            pasa: (f) => f.fechaMovimiento >= dia(hoy).desde && f.fechaMovimiento < dia(hoy).hasta,
          },
          {
            nombre: "periodo sin filas",
            input: { desde: "2026-01-01", hasta: "2026-01-02" },
            pasa: () => false,
          },
        ];
        const combinados: Medida["combinados"] = [];
        for (const c of combos) {
          const r = await listarMovimientosAction({ aQuien: tiendaA, ...c.input, page: 1, pageSize: 100 }, deps);
          if (r.status !== "ok") throw new Error(`combo ${c.nombre}: ${JSON.stringify(r)}`);
          const esperadas = filasA.filter(c.pasa);
          const porId = new Map(r.data.movimientos.map((x) => [x.id, x]));
          combinados.push({
            nombre: c.nombre,
            obtenido: r.data.movimientos.map((x) => x.id),
            esperado: esperadas.map((x) => x.id),
            // El DTO del camino en SQL es el mismo que el de Prisma: monto STRING y fecha ISO.
            dtoIgual: esperadas.every((x) => {
              const o = porId.get(x.id);
              return (
                o !== undefined &&
                o.monto === x.monto.toFixed(2) &&
                o.fechaMovimiento === x.fechaMovimiento.toISOString() &&
                o.origenTipo === x.origenTipo &&
                o.origenId === x.origenId &&
                o.registradoPor === x.registradoPor &&
                o.descripcion === x.descripcion
              );
            }),
          });
        }

        // ── El detalle de una fila de la composicion con «A quién» (flete del rechazo de la tienda A) ─
        const filaFlete = "ingreso_flete_devolucion" as const;
        const deFila = await listarMovimientosDeFilaAction({ aQuien: tiendaA, fila: filaFlete, page: 1 }, deps);
        if (deFila.status !== "ok") throw new Error(`deFila: ${JSON.stringify(deFila)}`);
        const categoriasFila = new Set<string>(categoriasDeFilaComposicion(filaFlete));

        // ── El selector ───────────────────────────────────────────────────────────────────────
        const todo = await quienesDelLibroCajaAction({}, depsFiltros);
        const deHoy = await quienesDelLibroCajaAction({ desde: hoy, hasta: hoy }, depsFiltros);
        const nombreDe = async (id: string) => {
          const u = await tx.usuario.findUniqueOrThrow({ where: { id }, select: { nombre: true, primerApellido: true, segundoApellido: true } });
          return [u.nombre, u.primerApellido, u.segundoApellido].map((p) => p?.trim() ?? "").filter((p) => p !== "").join(" ");
        };
        const nombres = { tiendaA: await nombreDe(esc.tiendaA), tiendaB: await nombreDe(esc.tiendaB), mensajero: await nombreDe(esc.mensajeroId) };
        const busqueda = await quienesDelLibroCajaAction({ busqueda: "CARTONERÁ" }, depsFiltros);
        const conTope = await quienesDelLibroCajaAction(
          {},
          { getActor: async () => actor, service: new FiltrosWalletService(new FiltrosWalletRepository(s.cliente), { quienes: 1 }) },
        );
        if (todo.status !== "ok" || deHoy.status !== "ok" || busqueda.status !== "ok" || conTope.status !== "ok") {
          throw new Error(`selector: ${JSON.stringify([todo.status, deHoy.status, busqueda.status, conTope.status])}`);
        }

        // ── Bordes: sesion, rol y forma ───────────────────────────────────────────────────────
        const tienda = { usuarioId: esc.tiendaA, rol: "adminTienda" as const };
        const bordes = {
          selectorSinSesion: await quienesDelLibroCajaAction({}, { getActor: async () => null, service: filtrosSrv }),
          selectorComoTienda: await quienesDelLibroCajaAction({}, { getActor: async () => tienda, service: filtrosSrv }),
          libroComoTienda: await listarMovimientosAction({ aQuien: tiendaA }, { ...deps, getActor: async () => tienda }),
          resumenComoTienda: await verResumenCajaAction({ aQuien: tiendaA }, { ...deps, getActor: async () => tienda }),
          aQuienConClaveDeMas: await listarMovimientosAction({ aQuien: { ...tiendaA, extra: 1 } }, deps),
          aQuienSinUuid: await verResumenCajaAction({ aQuien: { tipo: "tienda", id: "tienda-a" } }, deps),
          aQuienTipoAjeno: await verDesgloseEgresosAction({ aQuien: { tipo: "bodega", id: esc.tiendaA } }, depsEgresos),
          aQuienNombreVacio: await listarMovimientosAction({ aQuien: { nombre: "   " } }, deps),
          libroConClaveDeMas: await listarMovimientosAction({ quien: "x" }, deps),
          selectorConClaveDeMas: await quienesDelLibroCajaAction({ cuenta: "tienda" }, depsFiltros),
        };

        return {
          esperado,
          lecturas,
          combinados,
          deFila: {
            obtenido: deFila.data.movimientos.map((x) => x.id),
            esperado: filasA.filter((x) => categoriasFila.has(x.categoria)).map((x) => x.id),
          },
          opcionesTodo: todo.opciones,
          opcionesHoy: deHoy.opciones,
          opcionesBusqueda: busqueda.opciones.map((o) => ({ clase: o.clase, nombre: o.nombre })),
          opcionesTope: { n: conTope.opciones.length, hayMas: conTope.hayMas, hayMasSinTope: todo.hayMas },
          nombres,
          ids: { tiendaA: esc.tiendaA, tiendaB: esc.tiendaB, mensajero: esc.mensajeroId },
          cuentaDeAutoria,
          bordes,
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("anti-vacuidad: cada «a quien» del escenario tiene filas, y la tienda A de varios origenes", () => {
    const e = m().esperado;
    expect(e.tiendaA.length).toBeGreaterThanOrEqual(4);
    expect(e.tiendaB.length).toBeGreaterThanOrEqual(2);
    expect(e.mensajero.length).toBeGreaterThanOrEqual(2);
    expect(e.cartonera.length).toBe(2);
    expect(e.solano.length).toBe(1);
    // Los origenes de la tienda A salen de la columna «A quién»: pago, rechazo, pago de un gasto.
    const origenes = new Set(
      e.tiendaA.map((id) => m().cuentaDeAutoria.get(id)?.aQuien.beneficiario !== null ? "pago_por_cuenta" : "otro"),
    );
    expect(origenes).toEqual(new Set(["pago_por_cuenta", "otro"]));
  });

  it("R59: por TIENDA, el libro es exactamente el conjunto de la columna «A quién» de esa tienda", () => {
    for (const k of ["tiendaA", "tiendaB"] as const) {
      expect([...m().lecturas[k].ids].sort(), k).toEqual([...m().esperado[k]].sort());
      expect(m().lecturas[k].total, k).toBe(m().esperado[k].length);
    }
  });

  it("R59: por MENSAJERO, el libro es exactamente el conjunto de la columna «A quién» del mensajero", () => {
    expect([...m().lecturas.mensajero.ids].sort()).toEqual([...m().esperado.mensajero].sort());
    expect(m().lecturas.mensajero.total).toBe(m().esperado.mensajero.length);
  });

  it("R59: por NOMBRE LIBRE, sin mayusculas ni espacios de los bordes (dos escrituras del mismo nombre)", () => {
    expect([...m().lecturas.cartonera.ids].sort()).toEqual([...m().esperado.cartonera].sort());
    expect([...m().lecturas.solano.ids].sort()).toEqual([...m().esperado.solano].sort());
  });

  it("R59: una cuenta AJENA (sin filas) da 0 filas y tarjetas, desglose y conceptos en cero", () => {
    const a = m().lecturas.ajena;
    expect(a.ids).toEqual([]);
    expect(a.total).toBe(0);
    expect(a.descargaIds).toEqual([]);
    expect(a.conceptos).toEqual([]);
    expect(a.desglose).toEqual({ gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "0.00", indemnizacion: "0.00", total: "0.00" });
    const r = a.resumen as Record<string, unknown>;
    for (const campo of ["entradas", "salidas", "enCaja", "ganancia", "deTerceros", "capital"]) expect(r[campo], campo).toBe("0.00");
  });

  it("R54/R59: las tarjetas (cifras y composicion) suman EXACTAMENTE las filas del libro filtrado", () => {
    for (const [k, l] of Object.entries(m().lecturas)) {
      expect(l.resumen, k).toEqual(l.resumenDeLasFilas);
      expect(l.composicion, k).toEqual(l.composicionDeLasFilas);
      expect((l.resumen as { periodoFiltrado: boolean }).periodoFiltrado, k).toBe(true);
    }
    // No es trivial: con la tienda A hay dinero en las tarjetas.
    expect((m().lecturas.tiendaA.resumen as { entradas: string; salidas: string }).salidas).not.toBe("0.00");
  });

  it("R59: el desglose de egresos y los conceptos con movimientos son los de las filas del libro filtrado", () => {
    for (const [k, l] of Object.entries(m().lecturas)) {
      expect(l.desglose, k).toEqual(l.desgloseDeLasFilas);
      expect(l.conceptos, k).toEqual(l.conceptosDeLasFilas);
    }
    expect(m().lecturas.cartonera.desglose.gastoVariable).not.toBe("0.00");
  });

  it("R59/R3: la descarga con «A quién» trae las MISMAS filas que el libro", () => {
    for (const [k, l] of Object.entries(m().lecturas)) expect([...l.descargaIds].sort(), k).toEqual([...l.ids].sort());
  });

  it("R59: con dirección, concepto y periodo, el conjunto y el ORDEN son los del libro; el DTO es el de siempre", () => {
    const vistos = m().combinados;
    expect(vistos.map((c) => c.nombre)).toEqual(["Sale", "Entra", "concepto", "periodo de hoy", "periodo sin filas"]);
    for (const c of vistos) {
      expect(c.obtenido, c.nombre).toEqual(c.esperado);
      expect(c.dtoIgual, c.nombre).toBe(true);
    }
    // Anti-vacuidad: los recortes no son todos vacios ni todos el conjunto entero.
    expect(vistos.find((c) => c.nombre === "Sale")?.obtenido.length).toBeGreaterThan(0);
    expect(vistos.find((c) => c.nombre === "Entra")?.obtenido.length).toBeGreaterThan(0);
  });

  it("R59: el detalle de una fila de la composicion respeta «A quién»", () => {
    expect(m().deFila.esperado.length).toBeGreaterThan(0);
    expect([...m().deFila.obtenido].sort()).toEqual([...m().deFila.esperado].sort());
  });

  it("R59: el selector ofrece las tiendas, el mensajero y los nombres, con el numero de filas del filtro", () => {
    const o = m().opcionesTodo;
    const buscar = (clase: string, nombre: string) => o.find((x) => x.clase === clase && x.nombre === nombre);
    expect(buscar("tienda", m().nombres.tiendaA)).toEqual({
      clase: "tienda",
      nombre: m().nombres.tiendaA,
      valor: { tipo: "tienda", id: m().ids.tiendaA },
      movimientos: m().esperado.tiendaA.length,
    });
    expect(buscar("tienda", m().nombres.tiendaB)?.movimientos).toBe(m().esperado.tiendaB.length);
    expect(buscar("mensajero", m().nombres.mensajero)).toEqual({
      clase: "mensajero",
      nombre: m().nombres.mensajero,
      valor: { tipo: "mensajero", id: m().ids.mensajero },
      movimientos: m().esperado.mensajero.length,
    });
    // Las dos escrituras de «Cartonera del Valle» son UNA opcion con dos filas.
    const cartoneras = o.filter((x) => x.clase === "nombre" && x.nombre.toLowerCase() === "cartonera del valle");
    expect(cartoneras).toHaveLength(1);
    expect(cartoneras[0]?.movimientos).toBe(2);
    // Lo que el selector manda de vuelta filtra lo mismo que el selector cuenta.
    expect(m().lecturas.cartonera.total).toBe(2);
  });

  it("R59: el selector respeta el periodo (la cartonera de hoy es una, no dos)", () => {
    const hoy = m().opcionesHoy.find((x) => x.clase === "nombre" && x.nombre.toLowerCase() === "cartonera del valle");
    expect(hoy?.movimientos).toBe(1);
    expect(m().opcionesHoy.find((x) => x.clase === "nombre" && x.nombre === "Transportes Solano")?.movimientos).toBe(1);
  });

  it("R59: la busqueda es por nombre, sin mayusculas ni tildes; el tope recorta y dice `hayMas`", () => {
    expect(m().opcionesBusqueda.length).toBeGreaterThan(0);
    for (const x of m().opcionesBusqueda) expect(x.nombre.toLowerCase()).toContain("cartonera");
    expect(m().opcionesTope).toEqual({ n: 1, hayMas: true, hayMasSinTope: false });
  });

  it("R82: sin sesion `unauthenticated`; una tienda `forbidden` (selector, libro y tarjetas)", () => {
    const b = m().bordes;
    expect(b.selectorSinSesion).toEqual({ status: "unauthenticated" });
    expect(b.selectorComoTienda).toEqual({ status: "forbidden" });
    expect(b.libroComoTienda).toEqual({ status: "forbidden" });
    expect(b.resumenComoTienda).toEqual({ status: "forbidden" });
  });

  it("design §6: `.strict()` y uuid — una clave de mas, un id sin forma o un tipo ajeno son `validation_error`", () => {
    const b = m().bordes;
    for (const k of [
      "aQuienConClaveDeMas",
      "aQuienSinUuid",
      "aQuienTipoAjeno",
      "aQuienNombreVacio",
      "libroConClaveDeMas",
      "selectorConClaveDeMas",
    ]) {
      expect((b[k] as { status: string }).status, k).toBe("validation_error");
    }
  });
});
