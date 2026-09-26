import type { EstadoCuentaDTO, FilaEstadoCuentaDTO, TipoDeCuenta } from "@/lib/types/estado-cuenta";

// FICHA 458-D — dobles del ESTADO DE CUENTA tal como lo devuelve `verEstadoCuentaAction`. Los ids son
// uuid DE VERDAD a propósito: los tests afirman que ninguno llega al texto ni al nombre accesible (H6).

export const UUID_TIENDA = "3f1c2a9e-5b7d-4c21-9a0e-7d4b2c1e8f60";
export const UUID_MENSAJERO = "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d";
export const UUID_BODEGA = "c0ffee00-1234-4abc-8def-0123456789ab";
export const UUID_MOV = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;

export function fila(parcial: Partial<FilaEstadoCuentaDTO> & { n?: number; libro?: "tienda" | "mensajero" }): FilaEstadoCuentaDTO {
  const { n = 1, libro = "tienda", ...resto } = parcial;
  return {
    ref: { libro, movimientoId: UUID_MOV(n) },
    consolidacionId: null,
    fecha: "2026-09-12",
    categoria: "cod_recaudado",
    origenTipo: "cierre_dia",
    origen: { texto: "Cierre del día", enlace: null },
    pago: null,
    descripcion: null,
    registro: { nombre: null, automatico: { accion: "aprobacion_cierre", por: "Ana Admin" } },
    cargo: null,
    abono: "1000.00",
    saldoCorrido: "1000.00",
    chip: "cierres",
    anulacion: null,
    esContraAsiento: false,
    tieneComprobante: false,
    anulable: false,
    naceDeUnCierre: true,
    ...resto,
  };
}

export function estado(parcial: Partial<EstadoCuentaDTO> & { tipo?: TipoDeCuenta; nombre?: string; id?: string } = {}): EstadoCuentaDTO {
  const { tipo = "tienda", nombre = "Tania Tienda", id, ...resto } = parcial;
  const idCuenta = id ?? (tipo === "tienda" ? UUID_TIENDA : tipo === "mensajero" ? UUID_MENSAJERO : UUID_BODEGA);
  return {
    cuenta: { tipo, id: idCuenta, nombre },
    saldoActual: "1000.00",
    signo: "positivo",
    sentido: tipo === "bodega" ? "por_entregar" : "ordenex_debe",
    saldoInicial: "0.00",
    abonos: "1000.00",
    cargos: "0.00",
    saldoFinal: "1000.00",
    filas: [fila({})],
    total: 1,
    page: 1,
    pageSize: 20,
    ...resto,
  };
}

/** Forma de uuid en cualquier texto. */
export const FORMA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
