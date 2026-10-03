import { describe, it, expect, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import ExcelJS from "exceljs";

import { EntregaDescargaService } from "@/lib/services/EntregaDescargaService";
import { CajaKardexService, type SaldosDeCaja } from "@/lib/services/LibroKardexService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CabeceraDeCierre, FiltroAportesEnLote, OrdenAporteEnLoteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import type { DescargaArchivo, DescargaColumna } from "@/lib/types/descarga";
import { deserializarDescarga } from "@/lib/utils/codec-descarga";
import { construirDescarga } from "@/lib/utils/descarga-dataset";
import { filasDetallePorGuia, filasKardex } from "@/components/shared/wallet/libro-kardex-descarga";
import {
  COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA,
  COLUMNAS_DESCARGA_WALLET_CAJA,
  DETALLE_DESCARGA_WALLET_CAJA,
  filaBaseCaja,
  filaCabeceraGuiaCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { conceptoDeCaja, detalleDeCaja, fechaDeCaja } from "@/app/(app)/wallet/_components/libro-caja-kardex";
import { resultadosTexto } from "@/app/(app)/wallet/_components/detalle-movimiento-labels";
import { COLUMNAS_DESCARGA_ORDENES, filaDescargaOrden } from "@/app/(app)/ordenes/_components/ordenes-descarga-columnas";

/**
 * Ficha 470 (T3.4, R8) — el archivo producido con un conjunto que viajo por el ALMACEN es identico al
 * producido con el mismo conjunto entregado en la respuesta. Extremo a extremo y sin red: el resultado
 * pasa por `EntregaDescargaService` con umbral de 1 byte y un almacen EN MEMORIA, se recuperan los bytes
 * guardados, gunzip + `deserializarDescarga`, y con el original y el transportado se arma el archivo con
 * el codigo real de proyeccion de la pantalla y `construirDescarga`. Se comparan celda a celda (valores,
 * fechas, nombres de hoja, orden de columnas y negritas).
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const FECHA_ARCHIVO = new Date("2026-10-02T15:00:00Z");

/** Almacen en memoria: guarda los bytes y firma una URL ficticia. */
function almacenEnMemoria() {
  const objetos = new Map<string, Uint8Array>();
  let n = 0;
  const almacen: IAlmacenDescargas = {
    guardar: vi.fn(async (bytes: Uint8Array) => {
      n += 1;
      const ruta = `tmp/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.json.gz`;
      objetos.set(ruta, bytes);
      return { ruta };
    }),
    firmar: vi.fn(async (ruta: string) => `memoria://${ruta}`),
    purgarAnterioresA: vi.fn(),
  };
  /** Lo que haria el navegador con la URL: leer el objeto, descomprimir y deserializar. */
  const leer = <T>(url: string): T => {
    const bytes = objetos.get(url.replace("memoria://", ""));
    if (!bytes) throw new Error(`objeto inexistente: ${url}`);
    return deserializarDescarga<T>(gunzipSync(bytes).toString("utf8"));
  };
  return { almacen, leer };
}

/** El resultado por el camino de ALMACEN (umbral 1 byte), recuperado como lo haria el navegador. */
async function porAlmacen<T>(resultado: T): Promise<T> {
  const m = almacenEnMemoria();
  const sobre = await new EntregaDescargaService(m.almacen, { UMBRAL_ALMACEN_BYTES: 1, TTL_URL_SEGUNDOS: 300 }).entregar(resultado);
  if (sobre.modo !== "almacen") throw new Error("se esperaba el camino de almacen");
  return m.leer<T>(sobre.url);
}

/** El resultado por el camino DIRECTO (umbral holgado). */
async function directo<T>(resultado: T): Promise<T> {
  const m = almacenEnMemoria();
  const sobre = await new EntregaDescargaService(m.almacen, { UMBRAL_ALMACEN_BYTES: 2_000_000_000, TTL_URL_SEGUNDOS: 300 }).entregar(resultado);
  if (sobre.modo !== "directo") throw new Error("se esperaba el camino directo");
  return sobre.resultado;
}

interface CeldaLeida {
  hoja: string;
  fila: number;
  valores: unknown[];
  negrita: boolean;
}

/** Todas las celdas de todas las hojas, en orden, con la negrita de cada fila. */
async function leerXlsx(archivo: DescargaArchivo): Promise<CeldaLeida[]> {
  if (typeof archivo.contenido === "string") throw new Error("se esperaba un xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(archivo.contenido as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const celdas: CeldaLeida[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const valores: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (c) => valores.push(c.value instanceof Date ? c.value.toISOString() : c.value));
      celdas.push({ hoja: ws.name, fila: n, valores, negrita: row.getCell(1).font?.bold === true });
    });
  }
  return celdas;
}

// ─── (a) Libro de la caja con detalle por guia: el resultado REAL del servicio ───────────────────────

function ordenAporte(cierreId: string, n: number, numGuia: number | null): OrdenAporteEnLoteRow {
  return {
    cierreId,
    ordenId: `o-${cierreId}-${n}`,
    numGuia,
    numRemision: `REM-${cierreId}-${n}`,
    destinatario: `Destinatario «${n}» con "comillas"`,
    tiendaNombre: n % 2 === 0 ? "Tienda Ñandú" : "Tienda B",
    orden: { esCentral: false, esZonaEspecial: false, montoCobrar: "1000.00", cobraComision: false, tarifa: null },
    gestiones: [{ resultado: "entregado", montoRecibido: "1000.00", pagoMensajero: null, indemnizacion: null }],
  };
}

function movCaja(id: string, origenId: string, monto: string, fecha: string): WalletMovimientoDTO {
  return {
    id,
    tipo: "ingreso",
    categoria: "ingreso_cod_recaudado",
    monto,
    origenTipo: "cierre_dia",
    origenId,
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: fecha,
    dueno: "terceros",
    documento: null,
  } as WalletMovimientoDTO;
}

async function resultadoCajaConDetalle() {
  // c-1: 150 guias; c-2: 100 guias, una de ellas sin guia (sale en «Sin guía»).
  const filas = [
    ...Array.from({ length: 150 }, (_, i) => ordenAporte("c-1", i, 200_000 + i)),
    ...Array.from({ length: 100 }, (_, i) => ordenAporte("c-2", i, i === 50 ? null : 300_000 + i)),
  ];
  const detalle = new DetalleEnLoteService(
    {
      contarAportesPorCierre: async (f: FiltroAportesEnLote) => {
        const m = new Map<string, number>();
        for (const x of filas) if (f.cierreIds.includes(x.cierreId)) m.set(x.cierreId, (m.get(x.cierreId) ?? 0) + 1);
        return m;
      },
      listarAportesDeCierres: async (f: FiltroAportesEnLote) => filas.filter((x) => f.cierreIds.includes(x.cierreId)),
      cabecerasDeCierres: async (ids: readonly string[]) =>
        new Map<string, CabeceraDeCierre>(
          ids.map((id) => [id, { fecha: id === "c-1" ? "2026-09-10T18:00:00.000Z" : "2026-09-11T19:30:00.000Z", mensajeroNombre: `Mensajero ${id}` }]),
        ),
    },
    { listarPorIdsDeTienda: async () => [] },
    { listarPorIdsDeMensajero: async () => [] },
  );
  const items = [movCaja("m-1", "c-1", "150000.00", "2026-09-10T18:05:00.000Z"), movCaja("m-2", "c-2", "100000.00", "2026-09-11T19:35:00.000Z")];
  const caja: Pick<IWalletService, "listarMovimientosCompleto"> = {
    listarMovimientosCompleto: async () => ({ status: "ok", items, total: items.length }),
  };
  const saldos: SaldosDeCaja = {
    agregarPorCategoriaYTipo: async () => [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "250000.00" }],
    saldosTrasMovimientos: async () => new Map([["m-1", "150000.00"], ["m-2", "250000.00"]]),
  };
  const r = await new CajaKardexService(caja, saldos, detalle).kardexConDetalle({}, MAESTRO);
  if (r.status !== "ok") throw new Error(`fixture: se esperaba ok y llego ${r.status}`);
  return r;
}

/** Replica de `colocarLibroCaja` (WalletModule) con el codigo REAL de proyeccion, sin la autoria. */
function colocarCaja(items: WalletMovimientoDTO[], kardex: KardexDTO, porGuia: DetallePorGuiaDTO) {
  const hoja1 = filasKardex({
    movimientos: items,
    kardex,
    filaBase: (m, ordenes) => filaBaseCaja(m, undefined, ordenes),
    variante: "caja",
    fechaInicial: null,
  });
  const ordenesDe = new Map(items.map((m, i) => [m.id, kardex.filas[i].ordenes]));
  const hoja2 = filasDetallePorGuia({
    porGuia,
    cabeceraDe: filaCabeceraGuiaCaja,
    movimientoPorId: new Map(items.map((m) => [m.id, m])),
    conceptoDe: conceptoDeCaja,
    fechaDe: fechaDeCaja,
    detalleDe: (m) => detalleDeCaja(m, ordenesDe.get(m.id) ?? null),
    resultadosTexto,
  });
  return { hoja1, hoja2 };
}

/** Columnas ELEGIDAS: sin «A quién» y con «Registró» delante de «Saldo» (orden efectivo distinto). */
function columnasElegidasCaja(): DescargaColumna[] {
  const sinAQuien = COLUMNAS_DESCARGA_WALLET_CAJA.filter((c) => c.clave !== "aQuien");
  const registro = sinAQuien.find((c) => c.clave === "registro")!;
  const resto = sinAQuien.filter((c) => c.clave !== "registro");
  const iSaldo = resto.findIndex((c) => c.clave === "saldo");
  return [...resto.slice(0, iSaldo), registro, ...resto.slice(iSaldo)];
}

async function archivoCaja(r: Awaited<ReturnType<typeof resultadoCajaConDetalle>>): Promise<DescargaArchivo> {
  const { hoja1, hoja2 } = colocarCaja(r.items, r.kardex, r.porGuia);
  return construirDescarga(
    {
      titulo: "Libro de la caja",
      columnas: columnasElegidasCaja(),
      filas: hoja1.filas,
      ...(hoja1.filasDestacadas.length > 0 ? { filasDestacadas: hoja1.filasDestacadas } : {}),
      hojasAdicionales: [
        {
          titulo: DETALLE_DESCARGA_WALLET_CAJA.titulo,
          columnas: COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA.filter((c) => c.clave !== "mensajero"),
          filas: hoja2.filas,
          ...(hoja2.filasDestacadas.length > 0 ? { filasDestacadas: hoja2.filasDestacadas } : {}),
        },
      ],
    },
    FECHA_ARCHIVO,
  );
}

describe("470 — R8: libro de la caja con detalle por guia, directo vs almacen", () => {
  it("el resultado transportado es igual al original", async () => {
    const original = await resultadoCajaConDetalle();
    expect(await porAlmacen(original)).toEqual(original);
  });

  it("mismas hojas, nombres, columnas, filas, valores y negritas, celda a celda", async () => {
    const original = await resultadoCajaConDetalle();
    const viaDirecta = await leerXlsx(await archivoCaja(await directo(original)));
    const viaAlmacen = await leerXlsx(await archivoCaja(await porAlmacen(original)));

    // Anti-vacuidad: dos hojas, la segunda con TODAS las guias, y negritas presentes.
    const hojas = [...new Set(viaDirecta.map((c) => c.hoja))];
    expect(hojas).toHaveLength(2);
    expect(viaDirecta.filter((c) => c.hoja === hojas[1]).length).toBeGreaterThan(250);
    expect(viaDirecta.some((c) => c.negrita)).toBe(true);

    expect(viaAlmacen).toEqual(viaDirecta);
  });
});

// ─── (b) Ordenes: un DTO con fechas `Date` reales ────────────────────────────────────────────────────

function orden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 100000 + i,
    numRemision: `REM-${String(i).padStart(6, "0")}`,
    estatusId: "est-uuid",
    estatusValue: "entregado",
    destinatario: `Destinatario ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-uuid",
    provinciaId: "prov-uuid",
    cantonId: "canton-uuid",
    distritoId: "distrito-uuid",
    producto: `Producto ${i}; "con" comas, y saltos\nde línea`,
    peso: 1.5,
    notas: i % 5 === 0 ? null : `nota ${i}`,
    direccion: `Calle ${i}, casa ${i % 90}`,
    montoCobrar: 1000 + i,
    intentosEntrega: i % 3,
    createdAt: new Date(Date.UTC(2026, 6, 15, 20, i % 60)),
    updatedAt: new Date(Date.UTC(2026, 6, 16, 10, 0, i % 60)),
    relaciones: {
      estatus: { id: "est-uuid", value: "entregado" },
      tienda: { id: "tienda-uuid", nombre: "Tienda Relación", email: "tienda@x.com", telefono: "022222222", tarifa: null },
      zona: { id: "zona-uuid", nombre: "Zona Norte", esCentral: false },
      provincia: { id: "prov-uuid", nombre: "San José" },
      canton: { id: "canton-uuid", nombre: "Escazú" },
      distrito: { id: "distrito-uuid", nombre: "San Rafael" },
      mensajeroAsignado: i % 4 === 0 ? null : { id: "mens-uuid", nombre: "Luis Mora" },
    },
  } as OrdenListItemDTO;
}

const RESULTADO_ORDENES = { status: "ok" as const, items: Array.from({ length: 400 }, (_, i) => orden(i)), total: 400 };
const COLUMNAS_ORDENES_ELEGIDAS = [...COLUMNAS_DESCARGA_ORDENES].reverse().filter((_, i) => i % 4 !== 1);

async function archivoOrdenes(r: typeof RESULTADO_ORDENES, tipo: "xlsx" | "csv"): Promise<DescargaArchivo> {
  return construirDescarga({ tipo, titulo: "Órdenes", columnas: COLUMNAS_ORDENES_ELEGIDAS, filas: r.items.map(filaDescargaOrden) }, FECHA_ARCHIVO);
}

describe("470 — R8: listado de ordenes, directo vs almacen", () => {
  it("el resultado transportado es igual, con las fechas como Date", async () => {
    const t = await porAlmacen(RESULTADO_ORDENES);
    expect(t).toEqual(RESULTADO_ORDENES);
    expect(t.items[7].createdAt).toBeInstanceOf(Date);
  });

  it("xlsx celda a celda y csv byte a byte, con columnas elegidas en su orden", async () => {
    const t = await porAlmacen(RESULTADO_ORDENES);
    const d = await directo(RESULTADO_ORDENES);
    const xd = await leerXlsx(await archivoOrdenes(d, "xlsx"));
    const xa = await leerXlsx(await archivoOrdenes(t, "xlsx"));
    expect(xd).toHaveLength(401);
    expect(xa).toEqual(xd);
    const cd = await archivoOrdenes(d, "csv");
    const ca = await archivoOrdenes(t, "csv");
    expect(typeof cd.contenido).toBe("string");
    expect(ca.contenido).toBe(cd.contenido);
    expect(ca.nombreArchivo).toBe(cd.nombreArchivo);
  });
});
