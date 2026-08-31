"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { money } from "@/lib/config/moneda";
import { cn } from "@/lib/utils";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
  IngresoOrdenexDTO,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";
import type { OrigenFlete } from "@/lib/utils/ingreso-ordenex";
// Feature 158 (T2.3): las etiquetas visibles de la causa del incidente viven donde nacieron
// (junto al panel que las captura), no se duplican aquí. Importar un módulo de etiquetas de
// otra ruta tiene precedente EXACTO en este repo: `GestionarOrdenPanel` (mis-asignaciones)
// importa `estatus-label` de `app/(app)/ordenes/_components/`. El value crudo del enum
// (`danado`) no se pinta nunca.
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import {
  RESULTADO_LABEL,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
  RECHAZO_MANUAL_BADGE_LABEL,
  MONTO_COBRAR_COL,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  INGRESO_TOTAL_COL,
  CAUSA_INCIDENTE_COL,
  INDEMNIZACION_COL,
  METODO_LABEL,
  FULFILLMENT_COL,
} from "./cierre-labels";
// Feature 213 (T6/T7): el desglose de pago vive en UN solo sitio (R25). De ahí salen también
// el orden de los medios y el monto de cada uno, que es lo que estas tablas pintan por columna.
import { CLAVE_MEDIO_PAGO, MEDIOS_PAGO, montoPorMetodo } from "./desglose-pago";
import {
  COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
  COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
  COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
  COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
  filaDescargaGestionDevuelta,
  filaDescargaGestionEntregada,
  filaDescargaGestionIncidente,
  filaDescargaGestionRechazada,
  filaDescargaGestionReprogramada,
} from "./cierre-gestiones-descarga-columnas";

// Feature 40 (T8) — helpers y componentes compartidos del detalle de cierre entre
// el módulo de cierres de mensajero (feature 38, `CierresAdminModule`) y los nuevos
// módulos de cierre de bodega (adminSatelite `ConsolidacionBodegaModule` / maestro
// `CierresBodegaAdminModule`). Extraídos verbatim del `CierresAdminModule` original
// para NO duplicar: money-safe (R13), etiquetas i18n-ready, columnas por resultado
// con evidencia firmada (R12) y el visor de evidencia. Sin lógica de dominio propia.

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
//
// Feature 170 (tanda E): las que también necesita el archivo de la descarga viven ahora en
// `cierre-labels.ts` (módulo PURO, sin React) y se RE-EXPORTAN desde aquí, sin cambiar ni un
// texto: los consumidores que ya las importaban de este archivo siguen igual, y el módulo de
// columnas de export puede leerlas sin arrastrar `Card`/`Badge`/`DataTable`.
// Feature 213 (T7): la etiqueta de método SIGUE sin re-exportarse desde aquí. Este archivo la
// importa —encabeza una columna por medio de pago—, pero quien la necesite la pide a
// `cierre-labels.ts`, que es donde vive y de donde la leen por igual la pantalla y el archivo.
export {
  RESULTADO_LABEL,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  RECHAZO_ORIGEN_COL,
  RECHAZO_SLA_BADGE_LABEL,
  RECHAZO_MANUAL_BADGE_LABEL,
  MONTO_COBRAR_COL,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  INGRESO_TOTAL_COL,
  CAUSA_INCIDENTE_COL,
  INDEMNIZACION_COL,
};

export const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
  incidente: "No hay incidentes.", // feature 158/R18
};

// Feature 41 (R20): variante de badge por estado para diferenciar VISUALMENTE el
// `vencido` (generado por el corte diario: dinero sin conciliar mas alla del plazo)
// del `solicitado` en la misma cola de pendientes. `vencido` -> destructive (rojo,
// atencion); `solicitado` -> secondary (neutro). Los resueltos conservan su color.
export const ESTADO_BADGE_VARIANT: Record<
  CierreEstado,
  "default" | "secondary" | "destructive" | "outline"
> = {
  solicitado: "secondary",
  aprobado: "outline",
  rechazado: "destructive",
  vencido: "destructive",
};

/**
 * Feature 41 (R20): badge del estado de un cierre, con estilo diferenciado por
 * estado (ver `ESTADO_BADGE_VARIANT`). El `vencido` queda visualmente separado del
 * `solicitado` en la cola de pendientes de `/cierres-admin`. Texto i18n-ready.
 */
export function EstadoCierreBadge({ estado }: { estado: CierreEstado }) {
  return <Badge variant={ESTADO_BADGE_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>;
}

// Feature 109 (R31): en el modelo GLOBAL un cierre `rechazado` NO es terminal. Aunque el
// admin ya actuó (por eso vive en el histórico), sigue BLOQUEANDO al mensajero hasta que
// éste lo RE-SOLICITE (`rechazado → solicitado`) y se APRUEBE. El histórico lo rotula así
// para que no se lea como "resuelto/cerrado". Texto separado, i18n-ready.
export const RECHAZADO_BLOQUEANTE_LABEL = "Bloqueante hasta re-solicitud";
export const RECHAZADO_BLOQUEANTE_NOTA =
  "Un cierre rechazado no es terminal: sigue bloqueando al mensajero hasta que lo vuelva a solicitar y su bodega lo apruebe.";

/**
 * Feature 109 (R31): rótulo del estado de un cierre en el HISTÓRICO de `/cierres-admin`.
 * Un `rechazado` conserva su etiqueta ("Rechazado") pero se anexa el marcador visible
 * "Bloqueante hasta re-solicitud" (con nota accesible), porque NO es un estado resuelto:
 * bloquea hasta que el mensajero lo re-solicite y se apruebe. El resto de estados
 * (`aprobado`) se rotula tal cual. Texto i18n-ready; el marcador no comunica solo por color.
 */
export function EstadoHistoricoRotulo({ estado }: { estado: CierreEstado }) {
  if (estado === "rechazado") {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <span>{ESTADO_LABEL[estado]}</span>
        <RechazadoBloqueanteBadge />
      </span>
    );
  }
  return <>{ESTADO_LABEL[estado]}</>;
}

/**
 * Solo el marcador de "bloqueante", sin repetir la etiqueta del estado. Es lo que usa el
 * comprobante del histórico, donde el estado ya lo dice su propio badge: `EstadoHistoricoRotulo`
 * entero pintaría "Rechazado" dos veces.
 */
export function RechazadoBloqueanteBadge() {
  return (
    <Badge
      variant="destructive"
      title={RECHAZADO_BLOQUEANTE_NOTA}
      aria-label={RECHAZADO_BLOQUEANTE_NOTA}
    >
      {RECHAZADO_BLOQUEANTE_LABEL}
    </Badge>
  );
}

// =================================================================================================
// FEATURE 271 (R48) — QUE EL MENSAJERO DE ESTE CIERRE ESTA BLOQUEADO, Y POR QUE.
// =================================================================================================
//
// EL PROBLEMA MEDIDO: un `rechazado` no entra en la cola de «pendientes de decisión» —y no va a
// entrar, lo decidió el humano el 2026-08-23: sobre ese cierre la bodega YA decidió—, así que un
// mensajero podía arrastrar dos cierres sin aprobar y la administración ver una sola fila. Y
// aprobar el más antiguo es justamente lo que lo desbloquea: quien decide necesitaba saberlo.
//
// POR QUE VA EN LA FILA Y NO EN UNA COLA NUEVA: es un dato DE la fila —del dueño de ese cierre—,
// llega con ella en la misma lectura y no cuesta ninguna consulta más. Una cola nueva habría
// cambiado lo que la cola existente significa, y la leen tres pantallas.
//
// QUE DICE Y QUE NO. Dice CUÁNTOS cierres arrastra ese mensajero y cuántos esperan a que él los
// reenvíe; y dice qué hacer: aprobar el más antiguo. NO dice cuál es el más antiguo por su fecha
// —la fila no lo trae, y una fecha derivada aquí sería la de creación, que en un cierre vencido va
// un día por delante de la jornada que cierra—. Lenguaje claro, sin nombres de estado.
export const MENSAJERO_BLOQUEADO_LABEL = "Mensajero bloqueado";

/** El detalle del bloqueo tal como viaja en la fila del cierre. */
export interface BloqueoMensajeroBadgeProps {
  cierresAbiertos: number;
  cierresPorReenviar: number;
}

/**
 * El texto largo del marcador: va en `title` y en el nombre accesible, como el de «bloqueante»
 * de aquí arriba. Se compone —no es fijo— porque CUENTA, y un texto que cuenta no puede ser una
 * constante sin volverse mentira en cuanto cambie el número.
 */
export function notaMensajeroBloqueado({
  cierresAbiertos,
  cierresPorReenviar,
}: BloqueoMensajeroBadgeProps): string {
  const cuantos =
    cierresAbiertos === 1
      ? "Este mensajero arrastra 1 cierre sin aprobar"
      : `Este mensajero arrastra ${cierresAbiertos} cierres sin aprobar`;
  const suyos =
    cierresPorReenviar === 0
      ? ""
      : cierresPorReenviar === 1
        ? ", y 1 de ellos espera a que él lo vuelva a enviar"
        : `, y ${cierresPorReenviar} de ellos esperan a que él los vuelva a enviar`;
  // No puede entregar, cobrar ni recibir trabajo nuevo: es lo que hace que esto importe a quien
  // decide, y lo que convierte «aprobar el más antiguo» en una acción y no en un trámite.
  return `${cuantos}${suyos}. Mientras tanto no puede entregar, cobrar ni recibir trabajo nuevo. Aprueba el más antiguo para desbloquearlo.`;
}

/** El marcador de la fila. Se pinta SOLO si el mensajero está bloqueado. */
export function MensajeroBloqueadoBadge({
  cierresAbiertos,
  cierresPorReenviar,
}: Readonly<BloqueoMensajeroBadgeProps>) {
  const nota = notaMensajeroBloqueado({ cierresAbiertos, cierresPorReenviar });
  return (
    <Badge variant="destructive" title={nota} aria-label={nota}>
      {/* El número va EN el marcador, visible sin apuntar con el ratón: es el dato que decide si
          esta fila es urgente, y un `title` no se lee en un móvil ni con el teclado. */}
      {MENSAJERO_BLOQUEADO_LABEL} · {cierresAbiertos}
    </Badge>
  );
}

// --- Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready) ---
export const PAGO_MENSAJERO_LABEL = "Pago al mensajero";
// --- Feature 56: etiquetas del ingreso de bodega por rechazos (texto separado, i18n-ready) ---
export const INGRESO_BODEGA_RECHAZOS_LABEL = "Ingreso de bodega por rechazos";
// --- Feature 102 (R8): subtotales del ingreso de bodega por rechazos, particionado por ORIGEN.
// El total combinado sigue siendo el de la 56 (`INGRESO_BODEGA_RECHAZOS_LABEL`); estos dos son
// las sublíneas del desglose (SLA del cron 99 vs manual del mensajero). Texto i18n-ready. ---
export const INGRESO_BODEGA_RECHAZOS_SLA_LABEL = "Automático (por plazo vencido)";
export const INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL = "Manual (mensajero)";
// --- Feature 102 (R9): marca por fila del ORIGEN de un rechazo, para que cada ingreso de bodega
// sea auditable. `SLA` = escalado por el cron de vencimiento (99); `Manual` = rechazo del
// mensajero. Texto i18n-ready + nota accesible (`title`/`aria-label`). ---
export const RECHAZO_SLA_BADGE_NOTA =
  "Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero).";
export const RECHAZO_MANUAL_BADGE_NOTA =
  "Rechazo registrado manualmente por el mensajero.";
// --- Neto DERIVADO (total general - lo pagado a mensajeros): texto separado, i18n-ready ---
export const NETO_LABEL = "Total neto";
// --- Deuda de la central: el pago a mensajeros que el efectivo no cubrió (i18n-ready) ---
export const CENTRAL_DEBE_LABEL = "Central debe";
export const CENTRAL_DEBE_NOTA =
  "El efectivo no alcanzó para pagarle a todos los mensajeros (el pago no puede ser parcial).";
// --- Desglose del ingreso de Ordenex por orden (texto separado, i18n-ready) ---
export const MONTO_COBRAR_LABEL = "Monto a cobrar";
export const INGRESO_TOTAL_LABEL = "Total Ordenex";
export const INGRESO_PANEL_LABEL = "Ingreso de Ordenex";
// Conceptos AGRUPADOS (cada uno con su IVA incluido): así se leen en tablas y paneles.
// --- Bruto y ganancia del cierre (texto separado, i18n-ready) ---
export const INGRESO_BRUTO_LABEL = "Ingreso bruto";
export const INGRESO_BRUTO_NOTA =
  "Todo lo que facturó Ordenex en el cierre (flete + IVA + comisión + IVA), sin descontar nada.";
export const GANANCIA_LABEL = "Ganancia";
// Cuando la ganancia es NEGATIVA no es ganancia sino una deuda: se rotula "Debe".
export const GANANCIA_DEBE_LABEL = "Debe";
// --- Pago a la tienda: lo recibido menos lo que Ordenex le factura (texto separado, i18n-ready) ---
export const PAGO_TIENDA_LABEL = "Pago a tienda";
/**
 * ⏳ FICHA 338 (2026-08-31) — ESTA NOTA ENSEÑABA MAL, y era la frase que había que arreglar
 * aparte de los nombres. Decía «No descuenta el flete de devolución: una devolución no cobra
 * COD», y eso deja entender que una devolución cobra ALGO. No cobra nada: desde la ficha 301
 * `derivarIngresoOrden` sólo deriva conceptos con `resultado === "rechazada"`.
 *
 * El motivo REAL de que no se descuente está en `pagoTiendaOrdenex`: un rechazo no recauda COD,
 * así que ese dinero nunca entró en el total general y no hay nada de donde restarlo.
 */
export const PAGO_TIENDA_NOTA =
  "Total general menos flete + IVA y comisión + IVA. No descuenta el flete por rechazo: un rechazo no recauda contra entrega, así que ese dinero nunca entró en el total general.";
export const GANANCIA_NOTA = "Ingreso bruto menos el pago al mensajero.";
export const GANANCIA_NOTA_BODEGA = "Ingreso bruto menos el pago a los mensajeros.";
export const DESGLOSE_TITULO = "Desglose de ingreso";
/**
 * ⏳ FICHA 338 (2026-08-31) — EL PANEL DE LA DERECHA DEJA DE SER UNA LISTA DE PRECIOS.
 *
 * Se titulaba «Tarifa aplicada» y pintaba los nueve valores de la tarifa CONGELADA, con un
 * «← se aplicó» (`APLICADA_HINT`, retirado) en la única fila que de verdad se cobró. El humano
 * lo leyó como nueve cobros: ver nueve importes bajo ese título hace pensar que se cobraron los
 * nueve, y en una reprogramada —que no cobra nada— no había NI UNA FRASE que lo dijera: había
 * que deducirlo de una ausencia de marca.
 *
 * Lo que pinta ahora, decidido por el humano: **todos los conceptos posibles, cada uno con el
 * IMPORTE QUE ESTA GESTIÓN COBRÓ, y cero donde no aplica**. La columna pasa a ser SUMABLE y
 * cierra con su total, así que un cero ya no se puede leer como un cobro.
 *
 * Y por eso el título CAMBIA, que no es cosmética: con «Valor flete» diciendo ₡0 mientras la
 * tarifa vale ₡2.800, «Tarifa aplicada» sería FALSO —alguien pensaría que la tarifa está mal
 * configurada—. Con «Cobros de esta gestión», el cero es verdad literal.
 *
 * ⚠️ LÍMITE ACEPTADO Y DECLARADO POR EL HUMANO. Esta pantalla YA NO MUESTRA LA LISTA DE PRECIOS
 * de la tarifa congelada: «por qué ₡2.400 y no ₡2.800» no se audita aquí. La pantalla responde
 * «qué se cobró», no «qué precios existen». Lo que sí queda de la tarifa son los `hint` del
 * desglose de la izquierda (`tarifa GAM: ₡2.400`, `13,00 % de ₡2.400`), que citan el precio del
 * concepto que SÍ se cobró. La lista completa vive en `/configuracion/tarifas` y el snapshot
 * entero sigue viajando en `TarifaSnapshotDTO` para quien lo necesite por API.
 */
export const COBROS_TITULO = "Cobros de esta gestión";
/**
 * El importe de un concepto que NO se cobró. Es un STRING literal a propósito: acá no se hace
 * ni una operación de dinero (R13). Todo lo demás lo produce `derivarIngresoOrden` en el
 * servidor y llega ya formateable al DTO.
 */
export const COBRO_CERO = "0.00";
/**
 * Qué está viendo quien mira el panel, en una línea. El cero se COMPONE con el mismo `money()`
 * que pinta las celdas (precedente: `PAGO_SIN_TARIFA_NOTA`): escribirlo a mano dejaría la nota
 * hablando de un «0,00» mientras la columna dice «₡0».
 */
export const COBROS_NOTA = `Lo que se le cobró a la tienda por esta gestión, con la tarifa congelada al solicitar el cierre. Un ${money(
  COBRO_CERO,
)} es un concepto que no se cobró.`;
/** El cierre SUMABLE del panel: sale del DTO (`ingresoOrdenex.total`), no se suma acá. */
export const COBROS_TOTAL_LABEL = "Total cobrado";
export const SIN_COMISION_NOTA = "Esta orden no cobra comisión COD.";
// --- Tarifa especial por distrito (texto separado, i18n-ready) ---
/**
 * El flete SALIÓ del monto pactado para el distrito especial. Se resalta porque ese importe
 * no se puede reconciliar contra la tabla de precios normal: quien audita la fila necesita
 * saber que la columna GAM / no GAM no es de donde salió el número.
 */
export const ESPECIAL_BADGE_LABEL = "Especial";
export const ESPECIAL_BADGE_NOTA =
  "El flete salió de la tarifa especial pactada para el distrito, no de la tabla de precios normal.";
/**
 * El distrito ESTÁ marcado como zona especial pero la tarifa congelada no traía monto pactado,
 * así que se cobró la tarifa normal. El importe es idéntico al de una orden corriente: sin esta
 * marca el hueco de configuración sería invisible justo donde se audita el dinero. Misma señal
 * que en el listado de órdenes.
 */
export const ESPECIAL_SIN_PACTO_BADGE_LABEL = "Especial sin pacto";
export const ESPECIAL_SIN_PACTO_BADGE_NOTA =
  "Distrito marcado como zona especial, pero la tarifa congelada no tenía tarifa especial pactada: se cobró la tarifa normal.";
/**
 * Etiquetas de las dos filas del pacto especial. Se conservan TAL CUAL —incluido el «devuelta»
 * de la segunda— por la misma decisión de negocio que ya está escrita en
 * `configuracion/tarifas/_components/tarifas-labels.ts`: «Tarifa especial» es como ellos
 * conocen esos dos campos, y son los que nombran las columnas `tarifa_especial` y
 * `tarifa_especial_devuelta`. La ficha 338 renombra el FLETE, no el pacto.
 */
export const TARIFA_ESPECIAL_LABEL = "Tarifa especial";
export const TARIFA_ESPECIAL_DEV_LABEL = "Tarifa especial devuelta";

// --- ⏳ FICHA 338 (2026-08-31): los conceptos de dinero de UNA gestión, por su nombre ---
//
// EL NOMBRE, elegido por el humano para toda la app: **«Flete por rechazo»**. El concepto se
// llamaba «flete de devolución» / «flete devuelto» en pantallas, wallet, Excel y API, y ese
// nombre decía JUSTO EL CASO QUE NO COBRA: desde la ficha 301 una `devuelta` no deriva nada
// —el paquete sigue vivo en la calle— y sólo una `rechazada` cobra este flete
// (`lib/utils/ingreso-ordenex.ts`). No había plata mal cobrada: había vocabulario que asusta,
// y de hecho asustó —el humano abrió la ficha tras leer «Flete devuelto» en este panel—.
//
// Salen a constantes porque los pintan LOS DOS paneles del desglose (el de la izquierda con su
// fórmula, el de la derecha con el importe cobrado) y dos literales sueltos divergen a la
// primera corrección. `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts` vigila que
// ningún archivo de `app/` vuelva a decir «flete de devolución» ni «flete devuelto».
export const FLETE_LABEL = "Flete";
export const IVA_FLETE_LABEL = "IVA flete";
export const FLETE_RECHAZO_LABEL = "Flete por rechazo";
export const IVA_FLETE_RECHAZO_LABEL = "IVA del flete por rechazo";
export const COMISION_COD_LABEL = "Comisión COD";
export const IVA_COMISION_LABEL = "IVA comisión";
/**
 * Los cuatro nombres de COLUMNA de la tabla de precios: la misma zona paga distinto dentro y
 * fuera del GAM, así que son cuatro cobros POSIBLES y no dos. Coinciden a propósito con los
 * rótulos de `/configuracion/tarifas` (`TARIFA_CAMPO_LABEL`): la misma cifra no puede llamarse
 * de dos maneras según por qué pantalla se entre.
 */
export const VALOR_FLETE_LABEL = "Valor flete";
export const VALOR_FLETE_GAM_LABEL = "Valor flete GAM";
export const FLETE_RECHAZO_GAM_LABEL = "Flete por rechazo GAM";
/** Origen del flete, en el `hint` de la fila del desglose. */
export const HINT_TARIFA_ESPECIAL = "tarifa especial pactada";
export const SIN_TARIFA_CONGELADA_NOTA =
  "La tienda no tenía tarifa vigente al solicitar el cierre: no se derivó ningún ingreso para esta orden.";
// --- Feature 158 (R34/R9/R19): columnas propias del grupo `incidente` (texto i18n-ready) ---
/**
 * `indemnizacion === null` en un incidente NO es «cero»: es «todavía no se capturó». El monto
 * lo pone el admin AL APROBAR (R19), así que hasta entonces la celda muestra "—" con esta nota
 * accesible. Sin ella, un "—" se leería como «esta orden no se indemniza», que es lo contrario.
 */
export const INDEMNIZACION_PENDIENTE_NOTA =
  "Se captura al aprobar el cierre; todavía no se indemnizó.";

/** Aviso discreto (F1.4-5): pago de una entrega resuelto en cero (tarifa faltante). */
export const PAGO_SIN_TARIFA_LABEL = "Sin tarifa";
/**
 * El cero se compone con el MISMO formateador que pinta la celda de al lado (feature 201): la
 * nota explica un importe que el admin está viendo en la tabla, y escribirlo a mano la dejaría
 * diciendo `₡0.00` mientras la columna dice `₡0,00`.
 */
export const PAGO_SIN_TARIFA_NOTA = `El pago al mensajero de esta entrega se resolvió en ${money(
  "0.00",
)} (posible tarifa de zona sin configurar).`;

/**
 * Orden fijo de las secciones del detalle (R11). Feature 158/R18: `incidente` es un grupo
 * PROPIO y va AL FINAL, tras los cuatro desenlaces normales — mismo criterio que el detalle
 * del mensajero (37) y que el paso de resultados del panel.
 */
export const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

/**
 * Feature 201 (tanda C) — `money` ya NO se declara aquí: era una de las ocho copias byte a
 * byte del mismo helper, y por eso el detalle de un cierre enseñaba `₡13331832.72`. Vive en
 * `lib/config/moneda.ts` y se RE-EXPORTA desde aquí, exactamente como este archivo ya
 * re-exporta las etiquetas de `cierre-labels.ts`: los dos módulos de cierre (mensajero y
 * bodega) que lo importaban de aquí siguen sin cambiar un import.
 *
 * Sigue siendo money-safe (R13: NUNCA se parsea a número) y `null` sigue dando "—".
 */
export { money };

/**
 * El TOPE de una columna de dinero, pintado para un texto de formulario.
 *
 * Existe por la feature 230 y por un defecto que la 230 destapó: `money` redondea, y un
 * maximo NUNCA se redondea AL ALZA. `INDEMNIZACION_MONTO_MAX` es `"9999999999.99"`, que
 * `money` pinta `₡10.000.000.000` — once digitos—, asi que el mensaje pasaba a anunciar como
 * valido justo lo que el validador (`montoValido(monto, MAX)`, y el borde del servidor con
 * `Prisma.Decimal.lte`) RECHAZA, y ademas se contradecia con el «(10 digitos)» de su propia
 * frase. Al alza un limite deja de ser un limite.
 *
 * Aqui la cola decimal se DESCARTA en vez de decidir el redondeo: el tope se pinta hacia
 * ABAJO (`₡9.999.999.999`). El mensaje queda mas estricto que la realidad —por 99 centimos—,
 * que es el lado seguro: lo que anuncia como maximo el validador lo acepta.
 *
 * Money-safe: corta el STRING por el punto, sin `Number(`/`parseFloat(`/`.toFixed(`.
 *
 * ⚠️ Es para una cota POSITIVA, que es lo que son los topes de columna de este repo. Con un
 * tope negativo truncar acercaria al cero, o sea AL ALZA, y seria el lado inseguro.
 */
export function moneyTope(max: string): string {
  const punto = max.indexOf(".");
  return money(punto === -1 ? max : max.slice(0, punto));
}

/**
 * ¿El monto (STRING money-safe, escala 2 con signo, p. ej. "-12.50") es negativo?
 * Se lee el signo del texto: NO se parsea a número (money-safe, R13).
 */
export function esMontoNegativo(value: string | null): boolean {
  return value !== null && value.trimStart().startsWith("-");
}

/** Une la jerarquía geográfica en una línea legible (omite los vacíos). */
export function ubicacion(g: CierreDetalleGestion): string {
  return [g.zonaNombre, g.provinciaNombre, g.cantonNombre, g.distritoNombre]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

/** Ítem del panel de totales. */
export function TotalItem({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={emphasis ? "text-lg font-semibold" : "text-base font-medium"}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Panel de totales snapshot por método (R13): efectivo / SINPE / transferencia +
 * general. Los montos llegan como STRING y se renderizan tal cual (money-safe). Es
 * una `region` accesible con nombre `ariaLabel` para que el E2E la localice.
 */
export function TotalesPanel({
  totales,
  ariaLabel,
  title,
  labelGeneral = "Total general",
  neto,
}: {
  totales: CierreTotales;
  ariaLabel: string;
  title: string;
  labelGeneral?: string;
  /**
   * Neto DERIVADO server-side (STRING money-safe), si el consumidor lo tiene: se muestra
   * como un ítem MÁS del panel, junto al total general. Omitirlo deja el panel de 4 ítems
   * de siempre (los cierres de mensajero no derivan neto).
   */
  neto?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <Card>
        <CardContent
          className={`grid grid-cols-2 gap-4 pt-6 ${neto === undefined ? "sm:grid-cols-4" : "sm:grid-cols-5"}`}
        >
          <TotalItem label="Efectivo" value={money(totales.efectivo)} />
          <TotalItem label="SINPE" value={money(totales.simpe)} />
          <TotalItem
            label="Transferencia"
            value={money(totales.transferencia)}
          />
          <TotalItem label={labelGeneral} value={money(totales.general)} emphasis />
          {neto === undefined ? null : (
            <TotalItem label={NETO_LABEL} value={money(neto)} emphasis />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 39 (R17/R18/R20): total a pagar al mensajero, en un panel PROPIO y
 * SEPARADO del panel de dinero recibido (`TotalesPanel`) — es dinero que la empresa
 * DEBE al mensajero, no dinero recibido (R21). El monto llega como STRING y se
 * renderiza tal cual (money-safe). `region` accesible por `ariaLabel`.
 */
export function PagoMensajeroTotal({
  value,
  ariaLabel,
  label = PAGO_MENSAJERO_LABEL,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Card de un monto DERIVADO del cierre (bruto / ganancia), con la nota que explica de dónde
 * sale. Los montos llegan como STRING ya derivados server-side: acá no se resta dinero.
 * `region` accesible por `ariaLabel` (por defecto, la propia etiqueta).
 */
export function MontoDerivadoCard({
  value,
  label,
  nota,
  ariaLabel,
  tone = "default",
}: Readonly<{
  value: string;
  label: string;
  nota: string;
  ariaLabel?: string;
  /** `danger` pinta el monto en rojo (p. ej. una ganancia negativa = deuda). */
  tone?: "default" | "danger";
}>) {
  return (
    <section aria-label={ariaLabel ?? label} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{nota}</span>
          </span>
          <span
            className={cn(
              "text-lg font-semibold",
              tone === "danger" && "text-danger-strong",
            )}
          >
            {money(value)}
          </span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Deuda de la central con los mensajeros: la parte del pago que el EFECTIVO de la zona no
 * alcanzó a cubrir. El monto se deriva SERVER-SIDE y llega como STRING escala 2 (acá no se
 * hace aritmética de dinero). Se pinta en tono de atención porque es plata que alguien más
 * tiene que poner, no un total informativo. `region` accesible por `ariaLabel`.
 */
export function CentralDebeTotal({
  value,
  ariaLabel,
  label = CENTRAL_DEBE_LABEL,
  nota = CENTRAL_DEBE_NOTA,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
  nota?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{nota}</span>
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 56 (R10/R16/R17/R19): total del ingreso de bodega por rechazos, en un panel
 * PROPIO y SEPARADO del dinero recibido (`TotalesPanel`) y del pago al mensajero
 * (`PagoMensajeroTotal`). Espejo visual de `PagoMensajeroTotal`. El monto llega como
 * STRING y se renderiza tal cual (money-safe). `region` accesible por `ariaLabel`.
 */
export function IngresoBodegaRechazosTotal({
  value,
  ariaLabel,
  label = INGRESO_BODEGA_RECHAZOS_LABEL,
}: {
  value: string;
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <span className="text-lg font-semibold">{money(value)}</span>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 102 (R8): desglose del ingreso de bodega por rechazos, particionado por ORIGEN.
 * Hermano de `IngresoBodegaRechazosTotal` (misma card dashed) pero, DEBAJO del total combinado
 * ya existente (56), muestra las dos sublíneas del desglose: subtotal SLA (cron 99) y subtotal
 * manual (mensajero). Por construcción `sla + manual === total` (server-side, R5): acá NO se hace
 * aritmética. Los tres montos llegan como STRING (money-safe) y se renderizan con `money()`.
 * `region` accesible por `ariaLabel` (mismo nombre que `IngresoBodegaRechazosTotal` para que los
 * consumidores existentes lo sigan localizando).
 */
export function IngresoBodegaRechazosDesglose({
  desglose,
  ariaLabel,
  label = INGRESO_BODEGA_RECHAZOS_LABEL,
}: {
  desglose: { sla: string; manual: string; total: string };
  ariaLabel: string;
  label?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-2 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
            <span className="text-lg font-semibold">{money(desglose.total)}</span>
          </div>
          {/* Sublíneas del desglose (R8): separan el origen del ingreso sin recomputar el total. */}
          <div className="flex flex-col gap-1 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{RECHAZO_SLA_BADGE_LABEL}</Badge>
                {INGRESO_BODEGA_RECHAZOS_SLA_LABEL}
              </span>
              <span className="text-sm font-medium">{money(desglose.sla)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{RECHAZO_MANUAL_BADGE_LABEL}</Badge>
                {INGRESO_BODEGA_RECHAZOS_MANUAL_LABEL}
              </span>
              <span className="text-sm font-medium">{money(desglose.manual)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 39/56 (R16/R20/R23): render del pago al mensajero por orden. Money-safe: el
 * monto llega como STRING y se muestra tal cual. El aviso "Sin tarifa" ahora se decide
 * por el flag `tarifaFaltante` resuelto SERVER-SIDE (F1.4-Q6): reemplaza la heurística
 * de string `entregada && pago === "0.00"` de la 39 y aplica a ENTREGAS Y RECHAZOS.
 */
export function renderPagoMensajero(g: CierreDetalleGestion): ReactNode {
  return (
    <span className="inline-flex items-center gap-2">
      {money(g.pagoMensajero)}
      {g.tarifaFaltante ? (
        <Badge
          variant="outline"
          title={PAGO_SIN_TARIFA_NOTA}
          aria-label={PAGO_SIN_TARIFA_NOTA}
        >
          {PAGO_SIN_TARIFA_LABEL}
        </Badge>
      ) : null}
    </span>
  );
}

/** Columna del pago al mensajero por orden (R16/R20), reutilizable por sección. */
export const COLUMNA_PAGO_MENSAJERO: Column<CierreDetalleGestion> = {
  id: "pagoMensajero",
  value: PAGO_MENSAJERO_COL,
  render: renderPagoMensajero,
};

/**
 * Feature 56 (R12): columna del ingreso de bodega por rechazos por orden. Solo aplica a
 * la sección `rechazada`; money-safe (el monto llega como STRING, `null` → "—" vía
 * `money()`, NUNCA se parsea a número). Concepto separado del pago al mensajero.
 */
export const COLUMNA_INGRESO_BODEGA_RECHAZOS: Column<CierreDetalleGestion> = {
  id: "ingresoBodegaRechazo",
  value: INGRESO_BODEGA_RECHAZOS_COL,
  render: (g) => money(g.ingresoBodegaRechazo),
};

/**
 * Feature 102 (R9): marca por fila del ORIGEN de un rechazo — `SLA` (escalado por el cron 99)
 * o `Manual` (rechazo del mensajero), según `g.esRechazoSla`. El badge trae su nota accesible
 * (`title`/`aria-label`) para que el origen de cada ingreso de bodega sea auditable.
 */
export function renderRechazoOrigen(g: CierreDetalleGestion): ReactNode {
  return g.esRechazoSla ? (
    <Badge
      variant="secondary"
      title={RECHAZO_SLA_BADGE_NOTA}
      aria-label={RECHAZO_SLA_BADGE_NOTA}
    >
      {RECHAZO_SLA_BADGE_LABEL}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      title={RECHAZO_MANUAL_BADGE_NOTA}
      aria-label={RECHAZO_MANUAL_BADGE_NOTA}
    >
      {RECHAZO_MANUAL_BADGE_LABEL}
    </Badge>
  );
}

/**
 * Marca del ORIGEN de un flete cuando NO es el normal. Devuelve `null` para `"normal"`: la
 * inmensa mayoría de las filas lo son y un badge en todas no señalaría nada.
 *
 * Los dos casos que sí se pintan dicen cosas distintas y por eso no comparten variante:
 * `especial` es informativo (el sistema cobró el pacto, como se le pidió) y `especial_sin_pacto`
 * es una advertencia (falta configuración y el cobro se fue a la tarifa normal sin avisar).
 */
export function renderFleteOrigen(origen: OrigenFlete): ReactNode {
  if (origen === "especial") {
    return (
      <Badge variant="info" title={ESPECIAL_BADGE_NOTA} aria-label={ESPECIAL_BADGE_NOTA}>
        {ESPECIAL_BADGE_LABEL}
      </Badge>
    );
  }
  if (origen === "especial_sin_pacto") {
    return (
      <Badge
        variant="warning"
        title={ESPECIAL_SIN_PACTO_BADGE_NOTA}
        aria-label={ESPECIAL_SIN_PACTO_BADGE_NOTA}
      >
        {ESPECIAL_SIN_PACTO_BADGE_LABEL}
      </Badge>
    );
  }
  return null;
}

/**
 * Feature 102 (R9): columna del origen del rechazo. Solo aplica a la sección `rechazada`.
 * Marca cada fila como SLA o manual, sin exponer ningún subtotal (el desglose vive en el panel).
 */
export const COLUMNA_RECHAZO_ORIGEN: Column<CierreDetalleGestion> = {
  id: "rechazoOrigen",
  value: RECHAZO_ORIGEN_COL,
  render: renderRechazoOrigen,
};

/**
 * Un renglón del desglose desplegable: etiqueta a la izquierda, valor a la derecha. `hint`
 * explica de dónde sale el número (la fórmula aplicada), que es justo lo que el admin viene
 * a auditar.
 */
function DesgloseFila({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className={emphasis ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={emphasis ? "text-sm font-semibold" : "text-sm"}>{value}</span>
    </div>
  );
}

/** Porcentaje ya normalizado a STRING 0..100 por el server; solo se le pega el símbolo. */
function pct(value: string): string {
  return `${value} %`;
}

/**
 * Desglose completo del dinero de UNA orden: los conceptos derivados (flete, IVA, comisión)
 * con la fórmula que los produjo, y la tarifa CONGELADA de la que salieron — incluida la
 * variante que NO se aplicó, para que se vea por qué se eligió una u otra.
 *
 * Todos los montos llegan como STRING desde el server (money-safe): acá no se hace ninguna
 * aritmética de dinero, solo se muestran y se etiquetan.
 */
export function DesgloseIngresoOrdenex({ g }: { g: CierreDetalleGestion }) {
  const ing = g.ingresoOrdenex;
  if (!ing) return null;

  // Gap conocido (feature 69/R9): la tienda no tenía tarifa vigente al solicitar el cierre,
  // así que NO se derivó ningún concepto. Es un aviso real, no un error: el cierre es válido.
  if (ing.tarifa === null) {
    return (
      <div className="flex flex-col gap-1">
        <p role="note" className="text-sm text-destructive">
          {SIN_TARIFA_CONGELADA_NOTA}
        </p>
        <DesgloseFila label={MONTO_COBRAR_LABEL} value={money(ing.montoCobrar)} />
      </div>
    );
  }

  const t = ing.tarifa;
  // La zona elige la COLUMNA de tarifa, no la fórmula (feature 69/R21): mostrar cuál se
  // aplicó y cuál no es la mitad de la auditoría.
  const variante = ing.esCentral ? "GAM" : "no GAM";
  // …salvo cuando el distrito es especial Y la tarifa traía el pacto: ahí el flete NO sale de
  // ninguna de las dos columnas GAM, sino del monto pactado. Decir "tarifa GAM" en ese caso
  // sería una auditoría que no cuadra con la tabla de precios: el número no está ahí.
  //
  // `especial_sin_pacto` cae al `else`, y es correcto: en ese caso sí se cobró la columna
  // normal. Lo que falta ahí es la advertencia, y esa la pone la nota de abajo.
  const fleteEspecial = ing.fleteOrigen === "especial" && t.tarifaEspecial !== null;
  const fleteDevEspecial =
    ing.fleteDevolucionOrigen === "especial" && t.tarifaEspecialDevuelta !== null;
  const fleteAplicado = fleteEspecial
    ? (t.tarifaEspecial as string)
    : ing.esCentral
      ? t.valorFleteGam
      : t.valorFlete;
  const fleteDevAplicado = fleteDevEspecial
    ? (t.tarifaEspecialDevuelta as string)
    : ing.esCentral
      ? t.valorFleteDevueltoGam
      : t.valorFleteDevuelto;
  const origenFleteHint = fleteEspecial ? HINT_TARIFA_ESPECIAL : `tarifa ${variante}`;
  const origenFleteDevHint = fleteDevEspecial ? HINT_TARIFA_ESPECIAL : `tarifa ${variante}`;

  // ⏳ FICHA 337 (2026-08-31) — ¿SE COBRÓ ESTE CONCEPTO, Y DESDE QUÉ COLUMNA DE LA TARIFA?
  //
  // La 337 nació de un defecto visible: en una ENTREGA de zona GAM se marcaban a la vez "Valor
  // flete GAM" y "Flete devuelto GAM" —dos marcas para dos conceptos que se excluyen—, porque
  // cada fila decidía con `esCentral` (la zona) y NUNCA con el resultado de la gestión. La zona
  // elige la COLUMNA de la tarifa; el resultado elige QUÉ CONCEPTO se cobra.
  //
  // La fuente de verdad ya estaba en el DTO y no hace falta aritmética ninguna:
  // `derivarIngresoOrden` deja `flete` en `null` salvo en `entregada` y `fleteDevolucion` en
  // `null` salvo en `rechazada`. Un `null` es "este concepto no existe acá", que es exactamente
  // la pregunta.
  //
  // ⏳ FICHA 338 (2026-08-31): esto mismo es ahora lo que DECIDE DÓNDE VA EL IMPORTE en el panel
  // de cobros. Antes encendía un "se aplicó" al lado de un precio de la tarifa; ahora reparte el
  // ÚNICO importe de flete que la gestión cobró a la columna de la que salió, y deja las otras en
  // cero. Por eso las tres filas de flete de entrega suman exactamente `ing.flete` y las tres de
  // rechazo exactamente `ing.fleteDevolucion`: como mucho UNA de cada terna es distinta de cero,
  // y en una `reprogramada` (o en una `devuelta`, desde la 301) no lo es ninguna.
  //
  // Money-safe: se lee la PRESENCIA del concepto (`!== null`), jamás su importe. Ni una
  // comparación numérica, ni un `parseFloat`; un flete legítimo de "0.00" se reparte igual.
  const seCobroFlete = ing.flete !== null;
  const seCobroFleteDev = ing.fleteDevolucion !== null;
  type ColumnaTarifa = "pacto" | "normal-gam" | "normal-noGam";
  const columnaDe = (especial: boolean): ColumnaTarifa =>
    especial ? "pacto" : ing.esCentral ? "normal-gam" : "normal-noGam";
  const fleteAplicadoEs = (col: ColumnaTarifa) =>
    seCobroFlete && columnaDe(fleteEspecial) === col;
  const fleteDevAplicadoEs = (col: ColumnaTarifa) =>
    seCobroFleteDev && columnaDe(fleteDevEspecial) === col;
  // El importe cobrado por el flete de ENTREGA en esa columna de tarifa, o CERO si no salió de
  // ahí. No hay suma ni resta: se elige entre el STRING que mandó el servidor y un literal.
  const cobroFlete = (col: ColumnaTarifa): string =>
    fleteAplicadoEs(col) ? (ing.flete as string) : COBRO_CERO;
  /** Igual para el flete por RECHAZO. */
  const cobroFleteDev = (col: ColumnaTarifa): string =>
    fleteDevAplicadoEs(col) ? (ing.fleteDevolucion as string) : COBRO_CERO;
  /** Un concepto que no aplica a este resultado (`null`) se pinta como el cobro que fue: cero. */
  const cobrado = (monto: string | null): string => monto ?? COBRO_CERO;
  // La marca del distrito estaba puesta pero el pacto faltaba en la tarifa congelada: se cobró
  // la tabla normal. Se avisa una sola vez por orden, aunque afecte a los dos fletes.
  const faltaPacto =
    ing.fleteOrigen === "especial_sin_pacto" ||
    ing.fleteDevolucionOrigen === "especial_sin_pacto";

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* --- Lo que se derivó, con su fórmula --- */}
      <section className="flex flex-col" aria-label={DESGLOSE_TITULO}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{DESGLOSE_TITULO}</h4>
          {/* La marca del flete de ENTREGA encabeza el desglose; la del rechazo va en su
              propia fila más abajo. Si ninguna aplica, no se pinta nada. */}
          {renderFleteOrigen(ing.fleteOrigen)}
          {ing.fleteDevolucionOrigen === ing.fleteOrigen
            ? null
            : renderFleteOrigen(ing.fleteDevolucionOrigen)}
        </div>
        <DesgloseFila label={MONTO_COBRAR_LABEL} value={money(ing.montoCobrar)} />
        {ing.flete === null ? null : (
          <DesgloseFila
            label={FLETE_LABEL}
            value={money(ing.flete)}
            hint={`${origenFleteHint}: ${money(fleteAplicado)}`}
          />
        )}
        {ing.ivaFlete === null ? null : (
          <DesgloseFila
            label={IVA_FLETE_LABEL}
            value={money(ing.ivaFlete)}
            hint={`${pct(t.ivaFlete)} de ${money(fleteAplicado)}`}
          />
        )}
        {ing.fleteDevolucion === null ? null : (
          <DesgloseFila
            label={FLETE_RECHAZO_LABEL}
            value={money(ing.fleteDevolucion)}
            hint={`${origenFleteDevHint}: ${money(fleteDevAplicado)}`}
          />
        )}
        {ing.ivaFleteDevolucion === null ? null : (
          <DesgloseFila
            label={IVA_FLETE_RECHAZO_LABEL}
            value={money(ing.ivaFleteDevolucion)}
            hint={`${pct(t.ivaFlete)} de ${money(fleteDevAplicado)}`}
          />
        )}
        {ing.comisionCod === null ? null : (
          <DesgloseFila
            label={COMISION_COD_LABEL}
            value={money(ing.comisionCod)}
            hint={`${pct(t.comisionCod)} de ${money(ing.montoCobrar)}`}
          />
        )}
        {ing.ivaComisionCod === null ? null : (
          <DesgloseFila
            label={IVA_COMISION_LABEL}
            value={money(ing.ivaComisionCod)}
            hint={`${pct(t.ivaComisionCod)} de ${money(ing.comisionCod)}`}
          />
        )}
        {/* `cobraComision: false` no es un 0.00: la orden no genera comisión, y decirlo
            explícitamente evita que se lea como un cálculo que dio cero. */}
        {ing.cobraComision ? null : (
          <p className="pt-1 text-xs text-muted-foreground">{SIN_COMISION_NOTA}</p>
        )}
        {/* `role="note"`, como el aviso de tarifa faltante: no es un error del cierre, es un
            dato que el admin tiene que poder leer con un lector de pantalla. */}
        {faltaPacto ? (
          <p role="note" className="pt-1 text-xs text-warning-strong">
            {ESPECIAL_SIN_PACTO_BADGE_NOTA}
          </p>
        ) : null}
        <div className="mt-1 border-t pt-1">
          <DesgloseFila label={INGRESO_TOTAL_LABEL} value={money(ing.total)} emphasis />
        </div>
      </section>

      {/* --- ⏳ FICHA 338: TODOS los cobros posibles, con lo que ESTA gestión cobró en cada uno.
          Hasta hoy esta columna era la tarifa congelada entera —nueve PRECIOS— y sólo una marca
          discreta decía cuál se había aplicado; en una reprogramada no había marca ninguna y
          había que deducir de esa ausencia que no se cobró nada.

          Ahora cada fila lleva el IMPORTE, y CERO donde el concepto no se cobró, así que la
          columna se puede sumar de arriba abajo y termina en su total. Ni una operación de
          dinero se hace aquí: los importes son los STRING que derivó el servidor y el total es
          `ing.total` del DTO —la suma de los conceptos presentes, hecha con `Prisma.Decimal` en
          `CierresAdminRepository.toIngresoOrdenex`—.

          Las tres filas de flete de entrega —normal, GAM y pacto— son TRES COBROS POSIBLES de
          los que como mucho ocurre uno, y por eso se pueden listar las tres y sumarlas sin
          contar dos veces. Lo mismo con las tres del flete por rechazo. --- */}
      <section className="flex flex-col" aria-label={COBROS_TITULO}>
        <h4 className="mb-1 text-sm font-semibold">{COBROS_TITULO}</h4>
        {/* ⏳ FICHA 337 (2026-08-31): aqui se imprimia ademas el UUID crudo de la tarifa. Se
            RETIRA: a la persona que audita un cierre un identificador interno no le dice nada. El
            dato sigue viajando en `TarifaSnapshotDTO.tarifaId` para quien lo necesite por API. */}
        <p className="pb-1 text-xs text-muted-foreground">{COBROS_NOTA}</p>
        <DesgloseFila label={VALOR_FLETE_LABEL} value={money(cobroFlete("normal-noGam"))} />
        <DesgloseFila label={VALOR_FLETE_GAM_LABEL} value={money(cobroFlete("normal-gam"))} />
        {/* El pacto sólo se lista si la tarifa congelada lo traía: `null` significa "esta tarifa
            no pactaba nada", y una fila en cero se leería como un pacto de cero, que es otro
            dato. No se pierde plata al ocultarla: `fleteEspecial` exige que el pacto exista, así
            que con la fila ausente el importe va siempre a una columna normal. */}
        {t.tarifaEspecial === null ? null : (
          <DesgloseFila label={TARIFA_ESPECIAL_LABEL} value={money(cobroFlete("pacto"))} />
        )}
        <DesgloseFila label={FLETE_RECHAZO_LABEL} value={money(cobroFleteDev("normal-noGam"))} />
        <DesgloseFila
          label={FLETE_RECHAZO_GAM_LABEL}
          value={money(cobroFleteDev("normal-gam"))}
        />
        {t.tarifaEspecialDevuelta === null ? null : (
          <DesgloseFila label={TARIFA_ESPECIAL_DEV_LABEL} value={money(cobroFleteDev("pacto"))} />
        )}
        {/* ⏳ FICHA 338: estas cuatro eran PORCENTAJES ("Comisión COD 5,00 %", "IVA flete
            13,00 %"). Pasan a su IMPORTE cobrado porque, si no, no serían sumables con las de
            arriba y la ambigüedad que la ficha cierra volvería por otra puerta: un "13,00 %" en
            medio de una columna de dinero no dice si se cobró algo ni cuánto. El porcentaje sigue
            visible donde explica un cobro real: en el `hint` del desglose de la izquierda. */}
        <DesgloseFila label={IVA_FLETE_LABEL} value={money(cobrado(ing.ivaFlete))} />
        <DesgloseFila
          label={IVA_FLETE_RECHAZO_LABEL}
          value={money(cobrado(ing.ivaFleteDevolucion))}
        />
        <DesgloseFila label={COMISION_COD_LABEL} value={money(cobrado(ing.comisionCod))} />
        <DesgloseFila label={IVA_COMISION_LABEL} value={money(cobrado(ing.ivaComisionCod))} />
        <div className="mt-1 border-t pt-1">
          <DesgloseFila label={COBROS_TOTAL_LABEL} value={money(ing.total)} emphasis />
        </div>
      </section>
    </div>
  );
}

/** Nombre accesible del botón de desplegar: identifica SU orden, no un genérico repetido. */
export function desgloseAriaLabel(g: CierreDetalleGestion): string {
  return `${DESGLOSE_TITULO} de la orden ${g.numRemision} · ${g.destinatario}`;
}

/**
 * UNA COLUMNA POR MEDIO DE PAGO en las dos tablas del detalle (cierres de mensajero y de bodega
 * comparten esta declaración), en lugar de la celda única «Método» que llevaba el desglose
 * concatenado (feature 213, T7/R21).
 *
 * Cada columna enseña SOLO el monto que entró por ese medio, formateado con `money()` —moneda
 * de configuración, nunca un símbolo incrustado—; el medio sin línea pinta el MISMO marcador de
 * ausencia de siempre (R22), que es lo que `money(null)` ya hace. El monto sale del DESGLOSE del
 * DTO, nunca del campo escalar (R23), y el orden de las columnas es el del enum, uno para todos
 * los consumidores, en `desglose-pago.ts`.
 */
const COLUMNAS_MEDIO_PAGO: Column<CierreDetalleGestion>[] = MEDIOS_PAGO.map((metodo) => ({
  id: CLAVE_MEDIO_PAGO[metodo],
  value: METODO_LABEL[metodo],
  render: (g) => money(montoPorMetodo(g.pagos)[metodo]),
}));

// --- Columnas de dinero derivado por orden (solo el detalle admin las puebla) ---
const COLUMNA_MONTO_COBRAR: Column<CierreDetalleGestion> = {
  id: "montoCobrar",
  value: MONTO_COBRAR_COL,
  render: (g) => money(g.ingresoOrdenex?.montoCobrar ?? null),
};

/**
 * Monto FIJO de fulfillment, leído de la tarifa CONGELADA del cierre (2026-08-19).
 *
 * NO es un concepto derivado y por eso no sale de `columnaConcepto`: `derivarIngresoOrden` no
 * lo calcula, no entra en el «Total Ordenex» y no mueve wallets. Es un dato de la tarifa que el
 * cierre recuerda, y se pinta junto a «A cobrar» porque se lee con él.
 *
 * Vacío ("—") en dos casos que se ven igual y significan cosas distintas: la tienda no tenía
 * tarifa vigente al solicitar (gap R9), o el cierre es anterior a la columna
 * `cierre_detail.tarifa_fulfillment` (sin backfill: no hay valor correcto que inventar).
 */
const COLUMNA_FULFILLMENT: Column<CierreDetalleGestion> = {
  id: "fulfillment",
  value: FULFILLMENT_COL,
  render: (g) => money(g.ingresoOrdenex?.tarifa?.fulfillment ?? null),
};

/**
 * Columna de un flete (entrega o devolución) CON la marca de su origen al lado. Es la misma
 * celda de siempre —el monto formateado con `money()`, `null` → "—"— más el badge de
 * `renderFleteOrigen`, que sólo aparece cuando el flete no salió de la tabla normal.
 *
 * Va aparte de `columnaConcepto` porque el badge depende de un campo del DTO que el `pick` de
 * aquélla no ve: cada flete tiene SU origen (`fleteOrigen` / `fleteDevolucionOrigen`) y
 * mezclarlos pintaría la marca en la fila equivocada.
 */
function columnaFlete(
  id: string,
  value: string,
  monto: (i: IngresoOrdenexDTO) => string | null,
  origen: (i: IngresoOrdenexDTO) => OrigenFlete,
): Column<CierreDetalleGestion> {
  return {
    id,
    value,
    render: (g) => {
      const ing = g.ingresoOrdenex;
      if (!ing) return money(null);
      const marca = renderFleteOrigen(origen(ing));
      return marca === null ? (
        money(monto(ing))
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {money(monto(ing))}
          {marca}
        </span>
      );
    },
  };
}

/** Columna de un concepto derivado; `null` (no aplica a este resultado) → "—" vía `money`. */
function columnaConcepto(
  id: string,
  value: string,
  pick: (i: IngresoOrdenexDTO) => string | null,
): Column<CierreDetalleGestion> {
  return {
    id,
    value,
    render: (g) => money(g.ingresoOrdenex ? pick(g.ingresoOrdenex) : null),
  };
}

/**
 * Feature 158 (R9/R34): columna de la CAUSA tipificada del incidente. La etiqueta sale de
 * `CAUSA_INCIDENTE_LABEL` (derivada del SEED): nunca el slug crudo del enum. `null` sólo
 * podría verse si un resultado que no es `incidente` cayera en esta sección, y ahí "—" es la
 * lectura correcta.
 */
export const COLUMNA_CAUSA_INCIDENTE: Column<CierreDetalleGestion> = {
  id: "causaIncidente",
  value: CAUSA_INCIDENTE_COL,
  render: (g) => (g.causaIncidente ? CAUSA_INCIDENTE_LABEL[g.causaIncidente] : "—"),
};

/**
 * Feature 158 (R19/R22/R34): columna del MONTO de la indemnización. Money-safe: el monto llega
 * como STRING y se muestra tal cual con `money()`, sin `parseFloat`. `null` → "—" CON su nota:
 * el cierre todavía no se aprobó y el monto aún no existe (ver `INDEMNIZACION_PENDIENTE_NOTA`).
 */
export const COLUMNA_INDEMNIZACION: Column<CierreDetalleGestion> = {
  id: "indemnizacion",
  value: INDEMNIZACION_COL,
  render: (g) =>
    g.indemnizacion === null ? (
      <span title={INDEMNIZACION_PENDIENTE_NOTA} aria-label={INDEMNIZACION_PENDIENTE_NOTA}>
        —
      </span>
    ) : (
      money(g.indemnizacion)
    ),
};

/**
 * Columna de la evidencia FIRMADA (R12), compartida por `rechazada` e `incidente`
 * (feature 158/R18): abre el visor con la URL que ya llega firmada del servidor, nunca el
 * `storage_path` crudo. Se extrajo para no duplicar el render en dos ramas.
 */
const COLUMNA_EVIDENCIA = (
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion> => ({
  id: "evidencia",
  value: "Evidencia",
  render: (g) =>
    g.evidenciaUrl ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => verEvidencia(g.evidenciaUrl as string)}
      >
        Ver evidencia
      </Button>
    ) : (
      "—"
    ),
});

const COLUMNA_INGRESO_TOTAL: Column<CierreDetalleGestion> = {
  id: "ingresoTotal",
  value: INGRESO_TOTAL_COL,
  render: (g) =>
    g.ingresoOrdenex ? (
      <span className="font-medium">{money(g.ingresoOrdenex.total)}</span>
    ) : (
      "—"
    ),
};

// --- Columnas comunes a las 4 secciones del detalle (R11, reuso de la 37) ---
export const COLUMNAS_COMUNES: Column<CierreDetalleGestion>[] = [
  {
    // El número de guía es el dato con el que se busca la orden fuera de la app: se le
    // da ancho propio (2.5× el que pedía su contenido) para que no quede espichado
    // entre columnas más anchas ni se parta en dos líneas.
    id: "numGuia",
    value: "Nº Guía",
    render: (g) => <span className="font-semibold">{g.numGuia ?? "—"}</span>,
    minWidth: "250px",
  },
  { id: "numRemision", value: "Nº Remisión", minWidth: "120px" },
  { id: "destinatario", value: "Destinatario" },
  {
    id: "direccion",
    value: "Dirección",
    render: (g) => g.direccion ?? "—",
    minWidth: "200px",
  },
  { id: "ubicacion", value: "Ubicación", render: (g) => ubicacion(g) || "—" },
  { id: "producto", value: "Producto", minWidth: "300px" },
  { id: "tiendaNombre", value: "Tienda" },
];

/**
 * Construye las columnas de una sección del detalle: las comunes (R11) + las
 * específicas del resultado (monto + una columna por medio de pago si entregada R13; fecha+motivo si
 * reprogramada; motivo si devuelta; motivo+evidencia firmada si rechazada, R12).
 */
export function columnasPara(
  resultado: CierreResultado,
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion>[] {
  // Feature 158 (R17/R18/R34): el `incidente` NO deriva ningún concepto de ingreso de Ordenex
  // (ni flete, ni comisión, ni sus IVA), NO paga al mensajero y NO genera ingreso de bodega:
  // esas columnas serían "—" en todas las filas. Lo que SÍ lleva es el rastro del reporte
  // (causa + motivo + evidencia firmada) y el ÚNICO dinero que le corresponde: la
  // indemnización, que se captura al aprobar y hasta entonces es "—" (no es cero).
  if (resultado === "incidente") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      COLUMNA_FULFILLMENT,
      COLUMNA_CAUSA_INCIDENTE,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      COLUMNA_EVIDENCIA(verEvidencia),
      COLUMNA_INDEMNIZACION,
    ];
  }
  if (resultado === "entregada") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      COLUMNA_FULFILLMENT,
      { id: "monto", value: "Recibido", render: (g) => money(g.montoRecibido) },
      ...COLUMNAS_MEDIO_PAGO,
      // Conceptos que aplican a una ENTREGA, cada uno CON su IVA (los de devolución no se
      // listan acá: serían una columna de "—" en todas las filas). El split flete/IVA vive
      // en la fila desplegable.
      columnaFlete(
        "fleteConIva",
        FLETE_CON_IVA_LABEL,
        (i) => i.fleteConIva,
        (i) => i.fleteOrigen,
      ),
      columnaConcepto("comisionConIva", COMISION_CON_IVA_LABEL, (i) => i.comisionConIva),
      COLUMNA_INGRESO_TOTAL,
      // Feature 39/R16: pago al mensajero snapshot por orden (separado del dinero recibido).
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  if (resultado === "reprogramada") {
    // Una reprogramación no aporta a ningún concepto (la fórmula devuelve vacío): no se
    // pintan columnas de ingreso que serían "—" en todas las filas.
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      COLUMNA_FULFILLMENT,
      {
        id: "fechaReprogramacion",
        value: "Nueva fecha",
        render: (g) => g.fechaReprogramacion ?? "—",
      },
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  if (resultado === "devuelta") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_MONTO_COBRAR,
      COLUMNA_FULFILLMENT,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      // 2026-08-19: el flete de devolución se pinta AGRUPADO con su IVA, igual que en la
      // sección de rechazadas. El par partido (flete / IVA por separado) se retiró: son dos
      // columnas para un importe que siempre se lee sumado, y el split sigue disponible en la
      // fila desplegable del desglose.
      columnaFlete(
        "fleteDevolucionConIva",
        FLETE_DEV_CON_IVA_LABEL,
        (i) => i.fleteDevolucionConIva,
        (i) => i.fleteDevolucionOrigen,
      ),
      COLUMNA_INGRESO_TOTAL,
      COLUMNA_PAGO_MENSAJERO,
    ];
  }
  // rechazada: origen SLA/manual (102/R9) + motivo + evidencia firmada (R12) + ingreso de bodega
  // por rechazos (56/R12). Un rechazo deriva los MISMOS conceptos que una devolución (flete + IVA).
  return [
    ...COLUMNAS_COMUNES,
    COLUMNA_RECHAZO_ORIGEN,
    COLUMNA_MONTO_COBRAR,
    COLUMNA_FULFILLMENT,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    COLUMNA_EVIDENCIA(verEvidencia),
    columnaFlete(
      "fleteDevolucionConIva",
      FLETE_DEV_CON_IVA_LABEL,
      (i) => i.fleteDevolucionConIva,
      (i) => i.fleteDevolucionOrigen,
    ),
    COLUMNA_INGRESO_TOTAL,
    COLUMNA_PAGO_MENSAJERO,
    COLUMNA_INGRESO_BODEGA_RECHAZOS,
  ];
}

/**
 * Totales por concepto del cierre completo, sumados desde el MISMO desglose por orden que
 * muestran las tablas. Llegan ya derivados del server (`totalesIngresoOrdenex`): acá no se
 * suma dinero, solo se muestra (money-safe).
 */
export function TotalesIngresoPanel({
  totales,
  ariaLabel = INGRESO_PANEL_LABEL,
}: Readonly<{
  totales: TotalesIngresoOrdenex;
  ariaLabel?: string;
}>) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{INGRESO_PANEL_LABEL}</h3>
      <Card>
        {/* Cada concepto va CON su IVA en un solo monto: el IVA no es un concepto aparte,
            es parte de lo que se factura. El desglose separado vive en la fila desplegable. */}
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <TotalItem label={FLETE_CON_IVA_LABEL} value={money(totales.fleteConIva)} />
          <TotalItem label={COMISION_CON_IVA_LABEL} value={money(totales.comisionConIva)} />
          <TotalItem
            label={FLETE_DEV_CON_IVA_LABEL}
            value={money(totales.fleteDevolucionConIva)}
          />
          <TotalItem label={INGRESO_TOTAL_LABEL} value={money(totales.total)} emphasis />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Feature 170 (T E.5) — columnas y proyección de export POR RESULTADO. Vive aquí y no en el
 * módulo de columnas porque un `Record` exportado desde un `*-descarga-columnas.ts` se le
 * escaparía a la guardia de datos sensibles, que solo reconoce arrays de columnas y
 * funciones de proyección. Allí están las cinco declaraciones sueltas —vigiladas una a una—
 * y aquí, el mapa que elige cuál toca.
 */
const DESCARGA_POR_RESULTADO: Record<
  CierreResultado,
  { columnas: DescargaColumna[]; fila: (g: CierreDetalleGestion) => DescargaFila }
> = {
  entregada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
    fila: filaDescargaGestionEntregada,
  },
  reprogramada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
    fila: filaDescargaGestionReprogramada,
  },
  devuelta: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
    fila: filaDescargaGestionDevuelta,
  },
  rechazada: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
    fila: filaDescargaGestionRechazada,
  },
  incidente: {
    columnas: COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
    fila: filaDescargaGestionIncidente,
  },
};

/**
 * Las 4 secciones por resultado de un cierre (reuso del render de la 37/38, R11):
 * entregadas / reprogramadas / devueltas / rechazadas, cada una como `region`
 * accesible. La evidencia (R12) se abre por `onVerEvidencia` con la URL firmada.
 */
export function DetalleSecciones({
  grupos,
  onVerEvidencia,
  contexto,
}: {
  grupos: CierreGrupos;
  onVerEvidencia: (url: string) => void;
  /**
   * Feature 170 (T E.5): de QUIÉN son estas secciones (hoy, el nombre del mensajero del
   * `cierre_dia`). Se anexa al nombre de la descarga.
   *
   * No es cosmética: el detalle de un cierre de BODEGA monta estas secciones una vez POR
   * mensajero incluido, así que sin el contexto habría tres botones llamados «Descargar
   * Entregadas» en el mismo modal y ninguno diría de quién (R13). También hace que el
   * archivo se llame `entregadas-<mensajero>-<fecha>.xlsx` en vez de `entregadas-…`.
   */
  contexto?: string;
}) {
  return (
    <>
      {ORDEN_RESULTADOS.map((resultado) => {
        const filas = grupos[resultado] ?? [];
        // Pedido: no mostrar las secciones sin registros (p. ej. reprogramadas con 0).
        if (filas.length === 0) return null;
        const descarga = DESCARGA_POR_RESULTADO[resultado];
        const tituloDescarga = contexto
          ? `${RESULTADO_LABEL[resultado]} · ${contexto}`
          : RESULTADO_LABEL[resultado];
        return (
          <section
            key={resultado}
            aria-label={RESULTADO_LABEL[resultado]}
            className="flex flex-col gap-3"
          >
            <h4 className="text-sm font-semibold">
              {RESULTADO_LABEL[resultado]}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({filas.length})
              </span>
            </h4>
            <div className="overflow-x-auto">
              <DataTable
                columns={columnasPara(resultado, onVerEvidencia)}
                data={filas}
                rowKey="gestionId"
                ariaLabel={RESULTADO_LABEL[resultado]}
                emptyMessage={RESULTADO_VACIO[resultado]}
                /**
                 * Feature 170 (T E.5, R1/R8/R11/R22/R26/R30/R37) — UNA DESCARGA POR SECCIÓN
                 * (decisión del humano, P2 ratificada): cada resultado tiene sus columnas y
                 * su botón, y no hay un archivo único del cierre.
                 *
                 * Familia B: `filas` es el grupo COMPLETO que ya llegó con el detalle, así
                 * que el archivo sale de lo que la tabla pinta, en su mismo orden y sin
                 * releer. Descargar no toca el estado del modal ni la fila desplegada (R37):
                 * el control vive fuera del `<table>` y no llama a ningún setter.
                 *
                 * La URL FIRMADA de la evidencia NO viaja al archivo: la columna
                 * correspondiente es un «Sí/No» (R22).
                 */
                descarga={{
                  titulo: tituloDescarga,
                  columnas: descarga.columnas,
                  obtenerFilas: () => filasLocales(filas, descarga.fila),
                }}
                // Solo el detalle de admin trae `ingresoOrdenex`. Sin él se devuelve `null`
                // (y no un componente que renderiza vacío): así la tabla no pinta el botón
                // de desplegar sobre una fila que no tiene nada que mostrar.
                renderExpanded={(g) =>
                  g.ingresoOrdenex ? <DesgloseIngresoOrdenex g={g} /> : null
                }
                expandAriaLabel={desgloseAriaLabel}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}

/**
 * Visor de la evidencia fotográfica (URL FIRMADA, R12): nunca el storage_path
 * crudo. `url === null` → cerrado. Modal reutilizable entre módulos.
 */
export function VisorEvidencia({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={url !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Evidencia de la gestión"
      confirmLabel="Cerrar"
      hideCancel
      onConfirm={onClose}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Evidencia fotográfica de la gestión"
          className="max-h-[60vh] w-full rounded-md object-contain"
        />
      ) : null}
    </Modal>
  );
}
