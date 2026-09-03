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
// órdenes», 2026-07-31): quedaron **30 tablas = 24 dentro de alcance + 6 fuera**, con 29
// instancias de `<DataTable>` en 24 archivos. Se borró `OrdenesApartado.tsx` («Apartado de
// órdenes por estado», nº 2 del Anexo I), cuyo ÚNICO consumidor de producción era
// `OrdenesRevisionMaestro.tsx`, la vista legacy que ninguna página montaba. El spec 170 NO
// se reescribe: era cierto cuando se aprobó, y falsearlo borraría el motivo por el que los
// números bajaron. La capacidad no se pierde: `/ordenes` filtra por estado con
// `OrdenesListado`/`OrdenesModule` («Órdenes (listado principal)», nº 1), que sí descarga.
//
// Feature 171 (T2.6, R42) — SUMA de una tabla: el desglose del dinero de UNA tienda
// (`DesgloseMovimientosTienda.tsx`), que se despliega desde cada fila de «Saldos de
// tiendas». Nace `con_descarga`, que es lo que la guardia obliga a decidir: es un libro de
// dinero paginado en el servidor, la Familia A canónica de la 170, y declararla `fuera`
// habría exigido un motivo que no existe. Totales VIGENTES: **31 tablas = 25 dentro de
// alcance + 6 fuera**, con 30 instancias de `<DataTable>` en 25 archivos. Se incrementa
// desde los números REALES de arriba (24/29/24/30), no desde los del spec original, que ya
// estaban obsoletos cuando se escribió esta feature.
//
// Estados posibles de una tabla dentro de alcance:
//   - `con_descarga`: ya declara la prop `descarga` del `DataTable`.
//   - `pendiente`: dentro de alcance, la cablea la tanda indicada. Estado TRANSITORIO del
//     rollout: al cerrar la FASE 1 no debe quedar ninguno (T G.1/T G.2). Existe porque
//     las tandas entregan por lotes y ninguna puede dejar la suite roja.
//
// Feature 170 — FASE 2 (T I.2): CUATRO tablas CAMBIAN DE ARCHIVO, ninguna nace ni muere. Los
// históricos que pasan a paginación server-side se llevan su `<DataTable>`, su control y su
// descarga a un componente propio, porque el módulo del que salen enseña además un contador
// de cola (`({pendientes.length})`) que la tanda J todavía tiene que sustituir por el `total`
// del servidor —y la guardia de T H.3 prohíbe, con razón, que ese contador conviva con un
// control de paginación en el mismo archivo—. Totales VIGENTES: **31 tablas = 25 dentro de
// alcance + 6 fuera**, con 30 instancias de `<DataTable>` en **29 archivos**. Las instancias
// no se mueven; los archivos sí (25 → 29).
//
// Feature 170 (T G.1) — la FASE 1 está CERRADA: las 25 tablas del Anexo I descargan y no
// queda ningún `pendiente`. El valor sigue existiendo en el tipo porque un rollout futuro
// volverá a necesitarlo, pero `cobertura-tablas.guardia` («la FASE 1 del export queda
// cerrada…») FALLA si alguien lo reintroduce sin reabrir la fase: la fase no puede darse
// por terminada con tablas a medias, y una tabla a medias no puede colarse como terminada.
//
// chore «borrar código muerto de UI» (2026-08-07) — RESTA de una tabla, por decisión humana:
// sale `app/(app)/configuracion/_components/ZonasModule.tsx` («Zonas (configuración)»,
// censada `fuera` precisamente porque ninguna página la montaba). Igual que con
// `OrdenesApartado.tsx` el 2026-07-31, lo que se borró fue la vista, no una capacidad: la
// gestión de zonas vive y funciona en `configuracion/tarifas/_components/ZonasTarifasModule`,
// que no monta `<DataTable>` y por eso nunca figuró en este censo. Totales VIGENTES:
// **32 tablas = 26 dentro de alcance + 6 fuera**, con 31 instancias de `<DataTable>` en 30
// archivos (los de partida son los de la 172, ver `cobertura-tablas.guardia.test.ts`).
//
// ficha 336 «borrar /mis-pagos y /qr» (2026-08-30) — RESTA de una tabla, por decisión humana:
// sale `app/(app)/mis-pagos/_components/DesglosePagos.tsx` («Desglose de pagos del mensajero»,
// censada `con_descarga`). Tercera vez que este censo baja, y por el mismo motivo que las dos
// anteriores: el registro no puede citar un archivo borrado. A diferencia de `OrdenesApartado`
// y `ZonasModule`, aquí SÍ se pierde la capacidad: el mensajero no tiene otra pantalla donde
// ver lo que Ordenex le debe, y así lo decidió el humano con el dato delante. Los totales
// VIGENTES los declara `cobertura-tablas.guardia.test.ts`, que los MIDE contra el árbol; aquí
// no se copian para que no puedan divergir.

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
  /**
   * Feature 172 (T H.1) — solo para las tablas que viven en un componente COMPARTIDO: las
   * pantallas que la montan, declaradas una a una.
   *
   * Por qué hace falta un campo y no basta con la ruta del componente: el censo cuenta
   * `<DataTable>` del código fuente, y un componente compartido es UNA instancia de fuente
   * que el usuario ve como VARIAS tablas. Sin esta lista, montar la misma tabla en una
   * tercera pantalla no dejaría rastro en ningún sitio. La guardia contrasta la lista
   * contra el árbol en los dos sentidos: ni un montaje sin declarar, ni un declarado que ya
   * no exista.
   */
  montajes?: string[];
}

export interface ArchivoCensado {
  /** Ruta relativa a la raíz del repo, con separador `/`. */
  ruta: string;
  /** Una entrada por instancia de `<DataTable>` del archivo, en orden de aparición. */
  tablas: TablaCensada[];
}

// PEDIDO HUMANO DEL 2026-08-16 — SIETE BAJAS, y ninguna es una capacidad perdida. «Todas las
// cards de los cierres al componente de vista factura, para todos los roles»: los SEIS listados
// de cierres dejaron de ser `<DataTable>` y pasaron a ser tiras de comprobantes
// (`ListaComprobantes` + las hojas de `cierre-factura`). Los seis son:
//
//     Cierres solicitados (mensajero) ....... CierreDiaModule.tsx
//     Cierres del día — histórico ........... CierresAdminHistoricoTabla.tsx  (archivo borrado)
//     Cierres del día pendientes ............ CierresAdminModule.tsx
//     Cierres de bodega pendientes .......... CierresBodegaAdminModule.tsx
//     Cierres de bodega resueltos ........... CierresBodegaResueltosTabla.tsx (archivo borrado)
//     Cierres de bodega solicitados ......... CierresBodegaSolicitadosTabla.tsx (archivo borrado)
//     Cierres del día a consolidar .......... ConsolidacionBodegaModule.tsx
//
// Siete instancias, seis archivos: `CierreDiaModule` sigue en el censo porque conserva su OTRA
// tabla, la de gestiones del día por resultado, que no es un listado de cierres.
//
// LO QUE NO CAMBIA, y es la razón de que esto sea una baja del CENSO y no de la capacidad: los
// siete listados **siguen descargando**. La configuración `descarga` no se borró: se movió del
// `<DataTable>` a `<ListaComprobantes>`, que monta el MISMO `DescargarDatasetButton` con el
// mismo `obtenerFilas` contra el mismo conjunto del servidor. Este censo cuenta instancias de
// `<DataTable>`, así que la baja es real aquí y en ningún otro sitio. Quien vigila que esas
// descargas sigan entregando el CONJUNTO es `paginacion-transversal.test.tsx` (R52), que las
// tiene registradas por ruta y no por tipo de listado.
//
// Totales: 33 → 26 tablas = 25 `<DataTable>` en 25 archivos + 1 `<table>` cruda.
//
// FICHA 333 (H1) — SUMA de una tabla, `fuera`: «Cobros de gasto fijo por aprobar»
// (`app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx`). Es la cola que el maestro
// decide dentro de `/wallet`, y NO gana descarga: el motivo está en su entrada y es el mismo que
// `design.md §7` de la ficha dejó escrito —una cola de decisión efímera, de un puñado de filas,
// cuyo contenido aterriza en el LIBRO de la caja en cuanto se aprueba; y el libro sí descarga—.
// Se registra aquí porque es lo que `cobertura-tablas.guardia` obliga a DECIDIR: sin esta entrada
// la guardia se pone roja, que es exactamente el comportamiento buscado.
//
// Totales VIGENTES, medidos contra el árbol (no heredados del spec 170): **29 tablas = 28
// `<DataTable>` en 28 archivos + 1 `<table>` cruda**, con 9 exclusiones (8 con `<DataTable>` + la
// cruda). Se incrementan desde los números REALES de la feature 304 (28 = 27 + 1), no desde los
// del spec original, que ya estaban obsoletos cuando se escribió aquélla.
//
// FICHA 337 (segunda mitad) — SUMA de una tabla, `fuera`: «Cobros por rechazo de tienda por
// aprobar» (`app/(app)/wallet/_components/CobrosRechazoTiendaPendientesPanel.tsx`). Es la cola en
// la que un administrador decide si se le cobra a la tienda el retorno de una devolución que ella
// misma rechazó desde novedades, y NO gana descarga: el motivo está en su entrada y es el mismo,
// palabra por palabra, que el de su hermana de la 333 —cola de decisión efímera, cuyo contenido
// aterriza en libros que sí descargan—. Se registra aquí porque es lo que `cobertura-tablas.guardia`
// obliga a DECIDIR: sin esta entrada la guardia se pone roja, que es exactamente el comportamiento
// buscado (se vio fallar con «29 recibido / 28 esperado» antes de tocar los números).
//
// Totales VIGENTES, medidos contra el árbol: **30 tablas = 29 `<DataTable>` en 29 archivos + 1
// `<table>` cruda**, con 10 exclusiones (9 con `<DataTable>` + la cruda).
//
// FICHA 344 (B8.3) — SUMA de DOS tablas, y las dos nacen `con_descarga`: los desplegables de una
// fila del LIBRO de la caja (`wallet/_components/DetalleMovimientoCierre.tsx`) y del libro de la
// TIENDA (`mi-wallet/_components/DetalleMiMovimientoCierre.tsx`), que enseñan las órdenes que
// componen el importe de ese movimiento.
//
// LA DIFERENCIA CON LA FICHA 343, que es la que justifica el estado: aquel panel nació `fuera`
// porque era un recorte del MISMO libro que ya se descarga entero con sus filtros. Éstos enseñan
// algo que NINGUNA otra descarga produce —el reparto de un importe entre las órdenes que lo
// componen—, así que no son un segundo archivo del mismo hecho.
//
// Totales VIGENTES: **32 tablas = 31 `<DataTable>` en 31 archivos + 1 `<table>` cruda**, con 11
// exclusiones (las mismas que había: esta ficha no mueve ninguna). La guardia se vio FALLAR
// primero con «hay tablas sin registrar: app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx #1,
// app/(app)/wallet/_components/DetalleMovimientoCierre.tsx #1» antes de tocar estos números, que
// es la convención escrita en `cobertura-tablas.guardia.test.ts`.
//
// FEATURE 304 — SUMA de una tabla, `fuera`: «Órdenes con el monto redondeado (carga masiva)».
// Dice qué filas entraron con el monto redondeado al colón más cercano (aviso de la 299) y de
// cuánto a cuánto. No gana descarga y el motivo está escrito en su entrada: son filas del
// archivo que la tienda acaba de subir, y los dos pasos que la montan ya descargan lo suyo.
// Ninguna decisión de alcance previa cambia.

/**
 * Las 25 instancias de `<DataTable>` del árbol (25 archivos), en el orden en que aparecen
 * en cada archivo. Verificado contra el código, no de memoria.
 */
export const CENSO_DATATABLE: ArchivoCensado[] = [
  {
    // FICHA 345 (T8.3) — LA PRIMERA TABLA DE `/analitica`. Hasta hoy esa pantalla no montaba
    // ninguna `<DataTable>`: sus paneles son graficas y sus dos exports (el CSV operativo de la
    // 134 y el financiero) salen de controles propios, no de una tabla.
    //
    // Nace `con_descarga`, y el motivo es el que separa a las dos de la ficha 344 del panel de
    // la 343: lo que enseña —unidades, ordenes y efectividad POR PRODUCTO— no lo produce ninguna
    // otra descarga del repo. El CSV de la analitica operativa exporta series de metricas por
    // fecha; el grano «producto» no existe en el catalogo de dimensiones.
    //
    // Lo que NO lleva su archivo, dicho aqui porque es una decision y no un olvido: ni un uuid
    // (R49) y ni una cifra de dinero — el limite innegociable de la ficha.
    ruta: "app/(app)/analitica/_components/entregas/ProductosTabla.tsx",
    tablas: [{ nombre: "Productos del rango (analítica)", estado: "con_descarga" }],
  },
  {
    // FICHA 347 (F5/G5) — EL DETALLE ORDEN POR ORDEN del dinero de UNA fila de la tabla de
    // arriba. Se despliega desde su fila (`renderExpanded`) y solo existe para el actor que
    // tiene el dinero concedido.
    //
    // ⚠ NACE `fuera`, Y ES UNA DECISION CON MOTIVO, no un olvido — la guardia se vio ROJA
    // («hay tablas sin registrar: DineroProductoDetalle.tsx #1») antes de escribir esta
    // entrada, que es lo que obliga a decidir.
    //
    // El motivo NO es que sea un recorte de otro archivo —no lo es: ninguna descarga del repo
    // enseña que ORDENES componen el dinero de un producto—. Es que hoy **no existe la puerta
    // para servirlo entero**. Este panel pagina en el SERVIDOR, y el borde de la ficha
    // (`consultarDetalleDineroProducto`) solo tiene modo paginado: no hay un modo COMPLETO
    // como el que la 344 le dio a su hermano (`verDetalleDeMovimientoCompletoAction`). Con lo
    // que hay, un archivo saldria o bien truncado a una pagina —lo que R76 y la doctrina de
    // `filasDesdeResultado` prohiben, «o van todas las filas o no hay archivo»— o bien
    // reconstruido con N llamadas desde el navegador, que es exactamente la MEDIA MIGRACION
    // que la feature 184 retiro del arbol y que `adaptador-conjunto.guardia` vigila.
    //
    // ⟨Q5⟩ del spec de la ficha pregunta si la descarga del detalle entra, y la respuesta
    // escrita en `progress/impl_347.md` fue que NO. La consecuencia queda dicha: **R72 no esta
    // cubierto**. Cablearla cuesta un modo completo en el borde (backend) mas su contrato de
    // columnas; el dia que exista, esta entrada pasa a `con_descarga` y la guardia obliga a
    // volver aqui.
    ruta: "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx",
    tablas: [
      {
        nombre: "Órdenes con dinero de un producto (analítica)",
        estado: "fuera",
        nota:
          "el borde de la ficha 347 solo sirve el detalle PAGINADO: no hay modo completo, y " +
          "sin el un archivo saldria truncado a una pagina o reconstruido con N llamadas desde " +
          "el navegador --la media migracion que la feature 184 retiro--. Decision de " +
          "`specs/347-dinero-por-producto/requirements.md` ⟨Q5⟩, registrada en " +
          "`progress/impl_347.md`. R72 queda SIN cubrir hasta que exista esa puerta",
      },
    ],
  },
  {
    // Pedido humano del 2026-08-16: «Cierres solicitados (mensajero)» DEJÓ DE SER UNA TABLA.
    // Ver la nota de SEIS BAJAS en la cabecera de este archivo. La que queda es la del día.
    ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    tablas: [
      { nombre: "Gestiones del cierre del día por resultado", estado: "con_descarga" },
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
  // BORRADO (chore borrar-codigo-muerto, 2026-08-07): aquí estaba
  // `app/(app)/configuracion/_components/ZonasModule.tsx`, censado `fuera` porque ninguna
  // página lo montaba. Esa entrada dejó de existir con el archivo: la decisión humana fue
  // borrar el árbol entero (módulo + `ZonaForm` + `zonas-columns`), no seguir vigilándolo. La
  // gestión de zonas VIVA es `configuracion/tarifas/_components/ZonasTarifasModule.tsx`, que
  // no monta `<DataTable>` y por eso nunca entró en este censo. Con el borrado bajan los
  // totales de `cobertura-tablas.guardia.test.ts`: 31→30 archivos, 32→31 instancias, 6→5
  // exclusiones con `<DataTable>` y 33→32 tablas censadas.
  {
    ruta: "app/(app)/configuracion/api/_components/ApiKeysModule.tsx",
    tablas: [{ nombre: "API keys", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/configuracion/plantillas/_components/PlantillasModule.tsx",
    tablas: [{ nombre: "Plantillas de mensaje", estado: "con_descarga" }],
  },
  {
    // ⭑ FICHA 362 (T6.3) — SUMA de una tabla: el REGISTRO DE ACCIONES (quién hizo qué, sobre
    // qué y cuándo). Nace `con_descarga`, que es lo que la guardia obliga a decidir, y aquí
    // la decisión no tiene más de una respuesta razonable: es la Familia A canónica de la 170
    // —listado paginado en el servidor, con su propia acción de dataset completo
    // (`listarHistorialAccionesCompleto`) y el tope evaluado allí—, y un registro de
    // auditoría que no se puede sacar de la pantalla no sirve para auditar. Declararla
    // `fuera` habría exigido un motivo que no existe.
    //
    // Las diez columnas del archivo son las diez de la pantalla y NO llevan `id`, `entidadId`
    // ni `loteId` (R38): ver `historial-acciones-descarga-columnas.ts`.
    ruta: "app/(app)/historico/acciones/_components/HistorialAccionesModule.tsx",
    tablas: [{ nombre: "Registro de acciones", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    tablas: [{ nombre: "Incidentes pendientes de decisión", estado: "con_descarga" }],
  },
  {
    // Feature 170 — FASE 2 (T I.2): salió de `IncidentesAdminModule` (mismo motivo).
    ruta: "app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx",
    tablas: [{ nombre: "Incidentes — histórico", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx",
    tablas: [
      { nombre: "Desglose de movimientos de la tienda", estado: "con_descarga" },
    ],
  },
  {
    // FICHA 344 (B7/B8) — el desplegable de UNA fila del libro de la TIENDA: las órdenes de esa
    // tienda que componen el importe de ese movimiento. Va justo después de
    // `DesgloseTiendaLedger` porque la guardia recorre el árbol en orden alfabético.
    ruta: "app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx",
    tablas: [
      {
        nombre: "Órdenes que componen un movimiento del libro de la tienda",
        estado: "con_descarga",
      },
    ],
  },
  {
    // FEATURE 258 (F3.1) — ALTA. El detalle de un mensajero del tablero del día pasó de una
    // `<Table>` cruda a `<DataTable>` (design.md §8, R23/R35). NO es una tabla nueva para el
    // usuario: es la misma que ya existía desde la feature 192, que ahora se pinta con la
    // primitiva. Por eso sube el censo aunque no haya nacido ninguna pantalla.
    ruta: "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx",
    tablas: [
      {
        nombre: "Órdenes del día de un mensajero (detalle del tablero)",
        estado: "fuera",
        nota: "vista de LECTURA dentro de un modal de monitoreo, no un libro: R34 de la feature 258 le prohíbe ofrecer acciones, y el diseño le prohíbe expresamente `descarga` y `filtros` en su DataTable. La descarga de estas mismas órdenes vive en `/ordenes`, que sí la ofrece con el alcance completo",
      },
    ],
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
    ruta: "app/(app)/ordenes/_components/OrdenesConMontoAjustadoTabla.tsx",
    tablas: [
      {
        nombre: "Órdenes con el monto redondeado (carga masiva)",
        estado: "fuera",
        nota:
          "aviso de la feature 304 sobre el archivo que la propia tienda acaba de subir: son " +
          "las filas que traían céntimos, y los dos pasos que la montan ya ofrecen su descarga " +
          "(filas con error en la revisión previa, manifiesto y etiquetas en el resultado)",
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
    // Feature 196 (T5.2) — SUMA de una tabla: el ranking CONGELADO de una fecha ya cerrada.
    // Nace `con_descarga`, que es lo que la guardia obliga a decidir: es Familia B (el
    // histórico no pagina, el dataset completo ya está en el cliente) y declararla `fuera`
    // habría exigido un motivo que no existe — el archivo del histórico es justo lo que hace
    // auditable el podio y el premio que se pagó ese día.
    ruta: "app/(app)/ranking/historico/_components/RankingHistoricoModule.tsx",
    tablas: [{ nombre: "Ranking congelado del día (histórico)", estado: "con_descarga" }],
  },
  {
    ruta: "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx",
    tablas: [{ nombre: "Órdenes de la bodega satélite", estado: "con_descarga" }],
  },
  {
    // FICHA 333 (H1) — la cola de decisión del gasto fijo. Va antes de
    // `GastosFijosPlantillasPanel` porque la guardia recorre el árbol en orden alfabético.
    ruta: "app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx",
    tablas: [
      {
        nombre: "Cobros de gasto fijo por aprobar",
        estado: "fuera",
        nota:
          "cola de DECISIÓN efímera dentro de /wallet: un puñado de filas que existen sólo " +
          "hasta que alguien las aprueba o las rechaza, y que desaparecen de la sección en " +
          "cuanto se deciden. Lo aprobado aterriza en el «Libro de movimientos de la caja " +
          "principal», que SÍ descarga con el conjunto completo y sus filtros; lo rechazado no " +
          "produce movimiento alguno. Un archivo de esta cola sería la foto de un instante que " +
          "nadie puede volver a reproducir. Decisión de `specs/333-gasto-fijo-autorizacion/" +
          "design.md §7`",
      },
    ],
  },
  {
    // FICHA 337 (segunda mitad) -- la cola de decision del cobro por rechazo desde novedades. Va
    // entre `CobrosGastoFijoPendientesPanel` y `GastosFijosPlantillasPanel` porque la guardia
    // recorre el arbol en orden alfabetico.
    ruta: "app/(app)/wallet/_components/CobrosRechazoTiendaPendientesPanel.tsx",
    tablas: [
      {
        nombre: "Cobros por rechazo de tienda por aprobar",
        estado: "fuera",
        nota:
          "cola de DECISIÓN efímera dentro de /wallet, mismo criterio -- y mismo motivo-- que su " +
          "hermana «Cobros de gasto fijo por aprobar»: un puñado de filas que existen sólo hasta " +
          "que alguien las aprueba o las descarta, y que desaparecen de la sección en cuanto se " +
          "deciden. Lo aprobado aterriza en DOS libros que SÍ descargan con el conjunto completo " +
          "y sus filtros -- el «Libro de movimientos de la caja principal» y el desglose de " +
          "movimientos de la tienda--; lo descartado no produce movimiento alguno. Un archivo de " +
          "esta cola sería la foto de un instante que nadie puede volver a reproducir",
      },
    ],
  },
  {
    // FICHA 343 (B6.1) — el desplegable de UNA fila de la tarjeta de la ganancia. Va entre
    // `CobrosRechazoTiendaPendientesPanel` y `GastosFijosPlantillasPanel` porque la guardia
    // recorre el arbol en orden alfabetico.
    ruta: "app/(app)/wallet/_components/DetalleFilaComposicion.tsx",
    tablas: [
      {
        nombre: "Movimientos de una fila de la composición de la ganancia",
        estado: "fuera",
        nota:
          "desplegable de UNA fila de la tarjeta de la ganancia: es un recorte del MISMO libro " +
          "que «Libro de movimientos de la caja principal», que sí descarga el conjunto " +
          "completo con sus filtros -- incluido el filtro por categoría, que es exactamente lo " +
          "que este panel muestra--. Una segunda descarga del mismo dinero por otra puerta " +
          "sería un segundo archivo del mismo hecho. Decisión de " +
          "`specs/343-otros-gastos-detalle/design.md §8`",
      },
    ],
  },
  {
    // FICHA 344 (B6/B8) — el desplegable de UNA fila del LIBRO de la caja principal: las órdenes
    // que componen el importe de ese movimiento. Va entre `DetalleFilaComposicion` y
    // `GastosFijosPlantillasPanel` porque la guardia recorre el árbol en orden alfabético.
    ruta: "app/(app)/wallet/_components/DetalleMovimientoCierre.tsx",
    tablas: [
      {
        nombre: "Órdenes que componen un movimiento del libro de la caja",
        estado: "con_descarga",
      },
    ],
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
    // Feature 171 (T2.6): el desplegable del dinero de UNA tienda. Va antes que
    // `SaldosTiendasTable` porque la guardia recorre el árbol en orden alfabético.
    ruta: "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
    tablas: [
      { nombre: "Desglose de movimientos de una tienda", estado: "con_descarga" },
    ],
  },
  {
    ruta: "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
    tablas: [{ nombre: "Saldos de tiendas", estado: "con_descarga" }],
  },
  // ───────────────────────────────────────────────────────────────────────────────────────
  // Feature 172 (T H.1) — el árbol `components/`, que la guardia NO recorría hasta hoy.
  // ───────────────────────────────────────────────────────────────────────────────────────
  {
    // HALLAZGO de T H.1, no una tabla de la 172: existe desde la feature 130 y el censo no
    // podía verla porque el recorrido se paraba en `app/`. Se registra con su estado REAL.
    //
    // `fuera` con el mismo criterio que en su día se ratificó para `ZonasModule` (P4; aquel
    // módulo ya no existe, se borró el 2026-08-07): es un componente del
    // paquete de analítica SIN ningún consumidor montado en una página (`TablaResumen` solo
    // aparece en sus propios tests y en `components/private/analytics/tipos.ts`). No se le
    // cablea descarga aquí: eso sería tocar analítica, que la 172 declara fuera de alcance
    // (R68). Lo que sí se cierra es el punto ciego: si mañana alguien la monta en una
    // pantalla, el censo obliga a volver aquí y decidir.
    //
    // ── Feature 132 (2026-08-03): ESE MAÑANA LLEGÓ. ──────────────────────────────────────
    // El tablero financiero de `/analitica` es su PRIMER consumidor, en dos componentes de
    // servidor, y la guardia se puso roja tal como la 172 prometió. Se vuelve aquí y se
    // decide: SIGUE `fuera`, pero por un motivo DISTINTO. Ya no es «no la monta nadie»
    // —eso dejó de ser cierto—, sino que la descarga de la analítica es la feature **134**
    // (export CSV), declarada explícitamente fuera del alcance de la 132
    // (`specs/132-analitica-tablero-financiero/requirements.md §1`: «Export CSV → feature
    // 134. Aquí no hay descarga, ni botón, ni serializador»). Cablearla desde la 132
    // duplicaría el trabajo de la 134 en el mismo archivo.
    ruta: "components/private/analytics/TablaResumen.tsx",
    tablas: [
      {
        nombre: "Resumen de analítica (componente del paquete 130)",
        estado: "fuera",
        nota: "la descarga de analítica es la feature 134 (export CSV), declarada fuera del alcance de la 132, que es quien la monta por primera vez; el criterio de la 172 (sin consumidor montado) dejó de aplicar",
        montajes: [
          "app/(app)/analitica/_components/financiero/PanelConciliacion.tsx",
          "app/(app)/analitica/_components/financiero/TableroFinanciero.tsx",
        ],
      },
    ],
  },
  {
    // Feature 172 (T D.2/T H.1, R57) — la lista de COMPROBANTES de un beneficiario. Vive en
    // `components/shared/` porque la montan DOS pantallas con el mismo contenido; por eso es
    // UNA instancia de `<DataTable>` en el código y DOS tablas para quien las usa. Nace
    // `con_descarga` (Familia B: proyecta el mismo array que pinta, `design.md §10.4`).
    ruta: "components/shared/liquidacion/PagosRegistradosTabla.tsx",
    tablas: [
      {
        nombre: "Pagos registrados (comprobantes de liquidación)",
        estado: "con_descarga",
        montajes: [
          "app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx",
          "app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx",
        ],
      },
    ],
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
