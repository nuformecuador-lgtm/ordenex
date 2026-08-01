// Feature 170 (T0.5) — REGISTRO DEL CENSO de tablas de la aplicación.
//
// Es la lista declarada contra la que se contrasta el árbol (`cobertura-tablas.guardia`).
// No es documentación: si no coincide con el código, el test falla. Su razón de ser es que
// una tabla nueva NO pueda nacer sin que alguien decida —y deje escrito— si se descarga o
// por qué no (R4), y que una tabla declarada fuera de alcance no monte control (R2).
//
// El censo original está en `specs/170-export-todas-las-tablas/design.md §1` y en los
// Anexos I y II de `requirements.md`: 31 tablas = 25 dentro de alcance + 6 fuera. De las
// 31, 30 eran instancias de `<DataTable>` y 1 es una `<table>` HTML cruda (los premios del
// podio del ranking), que por eso se registra aparte.
//
// DIVERGENCIA DELIBERADA con ese spec (chore «borrar la vista legacy del listado de
// órdenes», 2026-07-31): hoy son **30 tablas = 24 dentro de alcance + 6 fuera**, con 29
// instancias de `<DataTable>` en 24 archivos. Se borró `OrdenesApartado.tsx` («Apartado de
// órdenes por estado», nº 2 del Anexo I), cuyo ÚNICO consumidor de producción era
// `OrdenesRevisionMaestro.tsx`, la vista legacy que ninguna página montaba. El spec 170 NO
// se reescribe: era cierto cuando se aprobó, y falsearlo borraría el motivo por el que los
// números bajaron. La capacidad no se pierde: `/ordenes` filtra por estado con
// `OrdenesListado`/`OrdenesModule` («Órdenes (listado principal)», nº 1), que sí descarga.
//
// Estados posibles de una tabla dentro de alcance:
//   - `con_descarga`: ya declara la prop `descarga` del `DataTable`.
//   - `pendiente`: dentro de alcance, la cablea la tanda indicada. Estado TRANSITORIO del
//     rollout: al cerrar la FASE 1 no debe quedar ninguno (T G.1/T G.2). Existe porque
//     las tandas entregan por lotes y ninguna puede dejar la suite roja.
//
// Feature 170 (T G.1) — la FASE 1 está CERRADA: las 25 tablas del Anexo I descargan y no
// queda ningún `pendiente`. El valor sigue existiendo en el tipo porque un rollout futuro
// volverá a necesitarlo, pero `cobertura-tablas.guardia` («la FASE 1 del export queda
// cerrada…») FALLA si alguien lo reintroduce sin reabrir la fase: la fase no puede darse
// por terminada con tablas a medias, y una tabla a medias no puede colarse como terminada.

/** Estado de una tabla censada respecto de la descarga. */
export type EstadoDescarga = "con_descarga" | "pendiente" | "fuera";

export interface TablaCensada {
  /** Nombre con el que la conoce el usuario (el del Anexo I / II). */
  nombre: string;
  /** Estado declarado. */
  estado: EstadoDescarga;
  /**
   * Tanda de `tasks.md` que la cablea (solo `pendiente`), o el motivo de la exclusión
   * (solo `fuera`). Obligatorio en ambos casos: una exclusión sin motivo es un olvido.
   */
  nota?: string;
}

export interface ArchivoCensado {
  /** Ruta relativa a la raíz del repo, con separador `/`. */
  ruta: string;
  /** Una entrada por instancia de `<DataTable>` del archivo, en orden de aparición. */
  tablas: TablaCensada[];
}

/**
 * Las 29 instancias de `<DataTable>` del árbol (24 archivos), en el orden en que aparecen
 * en cada archivo. Verificado contra el código, no de memoria.
 */
export const CENSO_DATATABLE: ArchivoCensado[] = [
  {
    ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    tablas: [
      { nombre: "Gestiones del cierre del día por resultado", estado: "con_descarga" },
      { nombre: "Cierres solicitados (mensajero)", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    tablas: [
      { nombre: "Cierres del día pendientes de decisión", estado: "con_descarga" },
      { nombre: "Cierres del día — histórico", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
    tablas: [
      { nombre: "Cierres de bodega pendientes", estado: "con_descarga" },
      { nombre: "Cierres de bodega resueltos", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx",
    tablas: [
      { nombre: "Cierres del día a consolidar", estado: "con_descarga" },
      { nombre: "Cierres de bodega solicitados", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx",
    tablas: [
      { nombre: "Gestiones de un cierre por resultado (detalle)", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/configuracion/_components/UsuariosModule.tsx",
    tablas: [{ nombre: "Usuarios", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/configuracion/_components/ZonasModule.tsx",
    tablas: [
      {
        nombre: "Zonas (configuración)",
        estado: "fuera",
        nota: "el módulo NO está montado en ninguna página (P4 ratificada): ConfiguracionPage solo renderiza UsuariosModule",
      },
    ],
  },
  {
    ruta: "app/(app)/configuracion/api/_components/ApiKeysModule.tsx",
    tablas: [{ nombre: "API keys", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/configuracion/plantillas/_components/PlantillasModule.tsx",
    tablas: [{ nombre: "Plantillas de mensaje", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    tablas: [
      { nombre: "Incidentes pendientes de decisión", estado: "con_descarga" },
      { nombre: "Incidentes — histórico", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx",
    tablas: [
      { nombre: "Desglose de movimientos de la tienda", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/mis-pagos/_components/DesglosePagos.tsx",
    tablas: [{ nombre: "Desglose de pagos del mensajero", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/ordenes/_components/GenerarGuiaModal.tsx",
    tablas: [
      {
        nombre: "Órdenes por numerar (modal «Generar guía»)",
        estado: "fuera",
        nota: "confirmación efímera de una selección en memoria; el mismo modal ya entrega el manifiesto xlsx del lote (feature 148)",
      },
    ],
  },
  {
    ruta: "app/(app)/ordenes/_components/OrdenesCargaResumen.tsx",
    tablas: [
      {
        nombre: "Resumen de carga masiva",
        estado: "fuera",
        nota: "ya ofrece el manifiesto xlsx del lote (feature 148, P3 ratificada)",
      },
    ],
  },
  {
    ruta: "app/(app)/ordenes/_components/OrdenesConErrorTabla.tsx",
    tablas: [
      {
        nombre: "Órdenes con error (previsualización)",
        estado: "fuera",
        nota: "ya tiene su propia descarga xlsx de filas con error (feature 143, P3 ratificada)",
      },
    ],
  },
  {
    ruta: "app/(app)/ordenes/_components/OrdenesExistentesTabla.tsx",
    tablas: [
      {
        nombre: "Órdenes ya existentes (previsualización)",
        estado: "fuera",
        nota: "paso de un asistente sobre un archivo aún no cometido (P3 ratificada)",
      },
    ],
  },
  {
    ruta: "app/(app)/ordenes/_components/OrdenesModule.tsx",
    tablas: [{ nombre: "Órdenes (listado principal)", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/ranking/_components/RankingModule.tsx",
    tablas: [{ nombre: "Ranking del día", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx",
    tablas: [{ nombre: "Órdenes de la bodega satélite", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
    tablas: [{ nombre: "Plantillas de gasto fijo", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/wallet/_components/WalletLedger.tsx",
    tablas: [
      { nombre: "Libro de movimientos de la caja principal", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
    tablas: [{ nombre: "Cuentas por pagar a mensajeros", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx",
    tablas: [
      { nombre: "Desglose de pagos por cierre de un mensajero", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
    tablas: [{ nombre: "Saldos de tiendas", estado: "con_descarga" }],
  },
];

/**
 * Tablas del árbol que NO son un `<DataTable>` (`<table>` HTML cruda). Se registran para
 * que el censo cuadre con el del spec (31 = 30 + 1) y para dejar constancia de la
 * decisión; la guardia comprueba que el archivo existe y que sigue sin montar descarga.
 */
export const CENSO_TABLAS_CRUDAS: ArchivoCensado[] = [
  {
    ruta: "app/(app)/ranking/_components/RankingModule.tsx",
    tablas: [
      {
        nombre: "Premios del podio (ranking)",
        estado: "fuera",
        nota: "<table> HTML cruda de 3 filas de configuración con montos editables; es configuración, no un listado de datos (P1 ratificada)",
      },
    ],
  },
];
