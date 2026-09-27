import type { CierreEstado } from "@/lib/types/cierre";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";

// Feature 40 — contrato del repositorio del "Cierre de bodega" (lado adminSatelite:
// consolidar + solicitar). Solo queries Prisma; sin logica de negocio (esa vive en
// CierreBodegaService). El ALCANCE (zona/estado) SIEMPRE va en el WHERE (R3/R5/R6),
// nunca filtrado en memoria. Money-safe: los Decimal se devuelven ya serializados a
// STRING; `crearCierreBodega` recibe los totales snapshot como STRING.

// Cabecera de un cierre_dia consolidable (aprobado, sin cierre de bodega): mensajero
// + totales snapshot (money-safe STRING). El detalle se deriva de sus gestiones.
export interface CierreDiaConsolidableRow {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (STRING escala 2)
  totalPagoMensajero: string; // feature 39/R18: snapshot del pago al mensajero del cierre_dia (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R17: snapshot del ingreso de bodega por rechazos del cierre_dia (STRING)
}

// Fila cruda de un cierre de bodega (cabecera). Totales ya como STRING (money-safe);
// `resueltoAt`/`motivoRechazo` null mientras `solicitado`. `cantidadCierres` = # de
// cierre_dia incluidos (_count).
export interface CierreBodegaResumenRow {
  cierreBodegaId: string;
  zonaId: string;
  zonaNombre: string;
  solicitadoPorId: string;
  solicitadoPorNombre: string;
  estado: CierreEstado;
  totales: CierreTotales;
  totalPagoMensajero: string; // feature 39/R19/R20: snapshot agregado del pago a mensajeros (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R19: snapshot agregado del ingreso de bodega por rechazos (STRING)
  cantidadCierres: number;
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
  /**
   * Feature 393 (R9/R20/R38) — DERIVADO en el MAPPER, no en un servicio: `totales.general` −
   * `totalPagoMensajero` − `totalIngresoBodegaRechazos` (STRING money-safe escala 2).
   *
   * LO QUE LA BODEGA SATELITE LE ENTREGA A LA CENTRAL. Vive aqui, en la fila del repositorio,
   * porque `toBodegaResumenRow` lo reusan las CUATRO lecturas de esta familia (cola del
   * maestro, historico del maestro, solicitados de la zona y los conjuntos completos de las
   * descargas): derivarlo una vez es lo que hace que la tarjeta del maestro y la del
   * adminSatelite NO PUEDAN discrepar. Puede ser NEGATIVO; se emite con su signo.
   */
  paraLaCentral: string;
  /**
   * Feature 393 (R37) — DERIVADO: ¿los dos descuentos caben en el EFECTIVO recaudado?
   * `false` enciende el aviso de pantalla. Booleano y no importe a proposito: la pantalla
   * necesita un aviso, no un cuarto numero.
   */
  efectivoCubreDescuentos: boolean;
  /**
   * ⭑ FICHA 431 (R26/R28) — LA MARCA DE CONCILIACION, en la fila que las superficies de
   * `/cierres-admin` ya leen.
   *
   * POR QUE VIAJA POR AQUI Y NO POR UNA LECTURA NUEVA: quien entrego el dinero tiene derecho a
   * saber si la central dijo que llego, y la bodega satelite ve SUS consolidaciones **donde ya
   * las ve hoy** —su pestana de cierres de bodega, acotada por zona en el `WHERE`
   * (`design.md §5`)—. Abrirle `/wallet/satelites` seria darle la vista de TODAS las bodegas,
   * que es justo lo que R27 prohibe. `ConsolidacionSateliteDTO` no le sirve: sus seis acciones
   * responden `forbidden` a `adminSatelite`.
   *
   * Los cuatro campos son ADITIVOS y los rellena el MISMO mapper que las ocho lecturas de esta
   * cabecera comparten (`toBodegaResumenRow`), asi que la tarjeta de la satelite y la de la
   * central NO PUEDEN discrepar: salen del mismo sitio.
   */
  conciliado: boolean;
  /** `null` = sin conciliar. NUNCA `"0.00"` por ausencia: cero recibido es otra cosa. */
  montoRecibido: string | null;
  /**
   * R17/R18/R20 — `total_efectivo` − COALESCE(`monto_recibido`, 0), DERIVADO EN EL SERVIDOR con
   * la MISMA funcion que usa `/wallet/satelites` (`lib/utils/conciliacion-satelite.saldoDe`).
   * La pantalla NO resta dinero. Puede ser NEGATIVO (llego de mas) y se emite con su signo.
   */
  faltaPorRecibir: string;
  conciliadoAt: string | null; // ISO
  conciliadoPorNombre: string | null;
  /**
   * Texto libre corto de quien marco. SI se ensena en pantalla —es lo que distingue una
   * conciliacion real de la RETROACTIVA del backfill (R30)— y NO baja a ninguna descarga.
   */
  conciliadoNota: string | null;
}

// Datos para crear la solicitud de cierre de bodega (R9/R10). Totales snapshot
// AGREGADOS como STRING; `cierreDiaIds` = los cierre_dia consolidados a vincular.
export interface CrearCierreBodegaInput {
  zonaId: string;
  solicitadoPor: string;
  cierreDiaIds: string[];
  totales: CierreTotales;
  totalPagoMensajero: string; // feature 39/R19: snapshot agregado del pago a mensajeros (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R18: snapshot agregado del ingreso de bodega por rechazos (STRING)
}

/**
 * FICHA 379/R18/R19 — el resumen de «lo que esta bodega tiene sin consolidar», y NADA mas.
 *
 * Money-safe: `totalGeneral` viaja como STRING de escala 2, nunca como `number`. Sin filas el
 * `_sum` de Prisma devuelve `null`, y aqui se traduce a `"0.00"` — que es un importe, no un
 * hueco: el aviso lo dice igual (AS1), porque el valor esta en saber que la zona se queda sin
 * nadie que pueda cerrarla, y el dinero es solo el numero de hoy.
 */
export interface ResumenConsolidablesPendientes {
  cantidad: number; // # de cierre_dia consolidables
  totalGeneral: string; // Decimal(12,2) serializado; "0.00" cuando no hay ninguno
}

export interface ICierreBodegaRepository {
  /**
   * R5: cierre_dia de la zona en `estado='aprobado'`, `destino_tipo='bodega_satelite'`,
   * `destino_zona_id=zonaId` y `cierre_bodega_id IS NULL` (aun no consolidados) +
   * mensajero + totales snapshot. Filtro por zona/estado en el WHERE.
   */
  /**
   * Pedido humano del 2026-08-16 — `filtros` es OPCIONAL (fecha + zona, SIN mensajero: un cierre
   * de bodega consolida los de varios) y RECORTA dentro del alcance, componiendose con `AND` y
   * nunca en lugar de el. Omitirlo deja el criterio IDENTICO al de antes.
   */
  findCierresDiaConsolidables(
    zonaId: string,
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreDiaConsolidableRow[]>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54): UNA PAGINA de los cierre_dia
   * consolidables de la zona + el TOTAL del conjunto (el que la cabecera mostrara, R42).
   *
   * MISMO `where` que `findCierresDiaConsolidables` —los cuatro predicados salen de una sola
   * funcion— y MISMO `orderBy solicitadoAt desc`. No devuelve totales de dinero: los agregados
   * de esa pantalla se calculan sobre el conjunto COMPLETO en el servicio (R49), y dos de
   * ellos dependen de los pagos INDIVIDUALES ordenados, que una pagina no contiene.
   */
  findCierresDiaConsolidablesPaginado(
    zonaId: string,
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreDiaConsolidableRow>>;
  /**
   * FICHA 379/R18 — el MISMO conjunto que `findCierresDiaConsolidables`, agregado.
   *
   * Cuenta e importe salen de `consolidablesWhere(zonaId)`: la funcion que ya decide que puede
   * consolidar esa bodega. Si alguien cambia ese criterio, el aviso cambia con el — que es
   * exactamente lo que no puede fallar aqui. Un aviso que dice un numero distinto del que la
   * pantalla de consolidacion ensena es peor que no avisar.
   *
   * SIN `filtros` a proposito: el aviso mira TODA la cola de la bodega, no el rango que alguien
   * tenga puesto en una pantalla. Money-safe: STRING escala 2, nunca `number` (R19).
   *
   * No devuelve ni una fila ni un nombre de persona: solo dos numeros (R22).
   */
  resumirConsolidablesPendientes(zonaId: string): Promise<ResumenConsolidablesPendientes>;
  /**
   * R6: cuenta los cierre_dia de la zona (`destino_tipo='bodega_satelite'`,
   * `destino_zona_id=zonaId`) aun en estado `solicitado` (pendientes de que el
   * adminSatelite los resuelva). Precondicion para poder cerrar la bodega.
   */
  contarCierresDiaSolicitados(zonaId: string): Promise<number>;
  // ⭑ FICHA 431 — AQUI VIVIA `existeCierreBodegaSolicitado(zonaId)`, el gate «a lo sumo una
  // consolidacion `solicitado` por zona» de la feature 40 (su R8). SE RETIRO con el indice unico
  // parcial que lo respaldaba (`cierre_bodega_zona_solicitado_uq`), y no es una limpieza: es el
  // corazon de la ficha. Con la aprobacion convertida en marca de conciliacion, «una pendiente por
  // zona» seria el MISMO bloqueo mudado de sitio — la satelite podria asignar pero no volver a
  // consolidar hasta que la central marcara.
  // Lo que ese gate protegia de verdad —que dos envios simultaneos no se repartan la misma cola—
  // vive ahora en el TODO-O-NADA de `crearCierreBodega`, que es donde esta la carrera.
  /**
   * R9/R10: bajo prisma.$transaction (todo-o-nada): (a) INSERT cierre_bodega
   * (`solicitado`, snapshot de totales agregados como Prisma.Decimal), (b) UPDATE
   * cierre_dia SET cierre_bodega_id=<nuevo> WHERE id IN (cierreDiaIds) AND
   * cierre_bodega_id IS NULL AND estado='aprobado' AND destino_zona_id=zonaId
   * (guardia concurrencia-segura). Devuelve el id del cierre de bodega.
   *
   * ⭑ FICHA 431 (R7) — Y SI LA GUARDIA VINCULA MENOS CIERRES DE LOS QUE SE LE PIDIERON, LANZA
   * `ConsolidacionParcialError` Y ABORTA LA TRANSACCION: no queda ni la fila ni los enlaces. No es
   * una precaucion generica. Los totales snapshot (`total_general`, `total_pago_mensajero`,
   * `total_ingreso_bodega_rechazos`) se calculan sobre el conjunto ENTERO antes de escribir, asi
   * que una consolidacion que enlace menos cierres de los que sumo DECLARA MAS DINERO DEL QUE
   * LLEVA. El servicio lo traduce a `conflict`.
   */
  crearCierreBodega(input: CrearCierreBodegaInput): Promise<string>;
  /**
   * F1.4-h: historico propio de la zona (todos los cierres de bodega de la zona), mas
   * reciente primero, totales snapshot -> STRING, `cantidadCierres` = _count.
   */
  findCierresBodegaByZona(
    zonaId: string,
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreBodegaResumenRow[]>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA de los cierres de bodega
   * SOLICITADOS por la zona + el TOTAL del conjunto.
   *
   * Es `findCierresBodegaByZona` con el recorte `skip`/`take`: MISMO `where { zonaId }` (el
   * acotamiento por zona, que es lo unico que separa a un adminSatelite del historico de otra
   * bodega) y MISMO `orderBy solicitadoAt desc` (R51). NO filtra por estado: este listado
   * muestra TODOS los cierres de bodega de la zona, resueltos o no, igual que hoy (R44).
   *
   * Pagina y total en la MISMA llamada: el `count` es la unica consulta que R54 permite
   * anadir, y comparte el `where` con la pagina para que no puedan contar cosas distintas.
   */
  findCierresBodegaByZonaPaginado(
    zonaId: string,
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>>;
}
