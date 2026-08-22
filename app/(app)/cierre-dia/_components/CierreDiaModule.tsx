"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { cierreConfig } from "@/lib/config/cierre";
import { money } from "@/lib/config/moneda";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import {
  deshacerGestion,
  listarCierresPasadosCompleto,
  listarCierresPasadosPaginado,
  solicitarCierre,
  verCierrePasado,
} from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreOrdenSinGestion,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreDestinoTipo } from "@/lib/types/cierre";
// Feature 158 (T2.3): la columna de la causa es la MISMA que la del detalle del admin — se
// reusa en vez de reescribirla, para que las dos pantallas no puedan divergir en la etiqueta.
import { COLUMNA_CAUSA_INCIDENTE } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
// Pedido humano: el detalle de un cierre pasado se lee con el MISMO comprobante del admin
// (feature 38/40), en su variante `mensajero`. Una sola hoja para las dos pantallas.
import {
  CierreFacturaDetalle,
  CierreFacturaResumenPropio,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
// Pedido humano del 2026-08-16: el histórico del mensajero deja de ser una tabla y pasa a ser
// la tira de comprobantes que usan las demás pantallas de cierres. Mismo envoltorio, mismos
// cuatro estados de listado.
import { ListaComprobantes } from "@/app/(app)/cierres-admin/_components/ListaComprobantes";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
// Feature 170 (T E.4): las etiquetas compartidas salen del módulo PURO (sin React) para que
// el archivo de la descarga y esta pantalla no puedan decir cosas distintas (R8).
import {
  DESTINO_TIPO_LABEL,
  ESTADO_LABEL,
  RESULTADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
// Feature 213 (T7): el desglose de pago se formatea en UN solo sitio para los cinco
// consumidores que lo pintan; esta pantalla ya no compone la etiqueta por su cuenta.
import { desglosePantalla } from "@/app/(app)/cierres-admin/_components/desglose-pago";
import {
  filasLocales,
  filasDesdeResultado,
} from "@/components/shared/descarga-resultado";
import {
  COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS,
  COLUMNAS_DESCARGA_DIA_DEVUELTAS,
  COLUMNAS_DESCARGA_DIA_ENTREGADAS,
  COLUMNAS_DESCARGA_DIA_INCIDENTES,
  COLUMNAS_DESCARGA_DIA_RECHAZADAS,
  COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
  filaDescargaDiaCierrePasado,
  filaDescargaDiaDevuelta,
  filaDescargaDiaEntregada,
  filaDescargaDiaIncidente,
  filaDescargaDiaRechazada,
  filaDescargaDiaReprogramada,
} from "./cierre-dia-descarga-columnas";

// Feature 37 (T15, R3-R7/R10/R11/R18): módulo cliente del "Cierre del día". Recibe
// del Server Component padre los grupos ya resueltos (por resultado), los totales
// snapshot-able, el gate `puedesSolicitar` + su `motivoBloqueo` y el histórico de
// cierres. Las mutaciones (Solicitar cierre; feature 67/R35-R38: Devolver a gestión)
// van por Server Action y refrescan la ruta para releer el estado del servidor. Los
// montos llegan como STRING (money-safe): se renderizan tal cual, sin `parseFloat`/`Number`.

/**
 * Feature 264 (Q1/R30) — lo que el visor de un cierre PASADO tiene cargado del servidor. Es una
 * sola lectura (`verCierrePasado`) y por eso es un solo estado: los grupos por resultado y, en
 * pie de igualdad, las órdenes que el corte cerró sin gestión con su marca de registro.
 *
 * `sinGestionRegistrado` no se deriva de que la lista esté vacía: `[]` con `true` es «no hubo
 * ninguna» y `[]` con `false` es «no lo sabemos» (R28). Son dos pantallas distintas.
 */
interface DetalleCierrePasado {
  grupos: CierreGrupos;
  ordenesSinGestion: CierreOrdenSinGestion[];
  sinGestionRegistrado: boolean;
}

/** Feature 170 — FASE 2 (T I.2): la página de «Cierres solicitados» tal como la da el servidor. */
export interface CierresPasadosPagina {
  items: CierrePasadoDTO[];
  total: number;
  pageSize: number;
}

export interface CierreDiaModuleProps {
  grupos: CierreGrupos;
  totales: CierreTotales;
  /** Feature 39/R11: total DERIVADO a pagar al mensajero (STRING), separado de `totales`. */
  totalPagoMensajero: string;
  puedesSolicitar: boolean;
  motivoBloqueo: string | null;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 de «Cierres solicitados» (R18), ya
   * resuelta server-side, más el `total` del conjunto. Deja de ser el array entero.
   *
   * OJO: es la ÚNICA tabla de esta pantalla que pagina. Las secciones por resultado son del
   * Anexo IV (vista agrupada de UNA jornada) y siguen recibiendo su grupo completo (R53); su
   * contador por grupo, derivado de `filas.length`, sigue siendo correcto y está declarado
   * como tal en la guardia de T H.3.
   */
  cierresPasados: CierresPasadosPagina;
  /**
   * Feature 41/R21: `true` si el mensajero está BLOQUEADO para GESTIONAR Y COBRAR.
   * Derivado server-side (`estadoBloqueoMensajero` → `findMensajerosBloqueadosParaGestion`)
   * y pasado por props; el módulo solo muestra el aviso, nunca re-deriva el estado del
   * cierre en el cliente.
   *
   * ⚠️ FEATURE 241 (2026-08-20) — QUÉ LO ENCIENDE HOY, porque cambió: `vencido` o
   * `rechazado`, y NADA MÁS. Este doc decía «tiene un cierre `solicitado`/`vencido`
   * pendiente» y «el bloqueo es TOTAL (no puede gestionar NI recibir)»; las dos cosas son
   * falsas con la regla firmada. Con `solicitado` la pelota está en el tejado del admin
   * (mediana 8,2 h, p90 22,1 h) y el mensajero trabaja con normalidad, así que el flag
   * llega en `false` y el aviso NO se pinta: el filtro vive en el predicado del servidor,
   * no aquí. Y recibir asignaciones no se bloquea nunca, en ningún estado.
   */
  bloqueado: boolean;
  /**
   * Feature 111/R13: `true` si el mensajero tiene un cierre `vencido`. Habilita un
   * CTA diferenciado para SOLICITAR (enviar a aprobación) ese vencido, con
   * INDEPENDENCIA del gate de creación (`puedesSolicitar`). Derivado server-side.
   */
  tieneVencido: boolean;
  /**
   * Feature 109/R31: `true` si el mensajero tiene un cierre `rechazado`. En el modelo
   * GLOBAL un `rechazado` NO es terminal: bloquea y es RE-SOLICITABLE. Habilita el MISMO
   * CTA de re-solicitud que el `vencido` (misma Server Action `solicitarCierre`, que el
   * backend enruta a la transición `rechazado → solicitado`), con INDEPENDENCIA del gate
   * de creación (`puedesSolicitar`). Derivado server-side. Excluyente del `vencido` en la
   * práctica (invariante R30: nunca 2 cierres abiertos a la vez).
   */
  tieneRechazado: boolean;
}

// Feature 41/R21 + 111/R12 → 241: aviso accionable del bloqueo (texto separado, i18n-ready).
//
// ⚠️ FEATURE 241 (2026-08-20) — EL TEXTO CAMBIÓ PORQUE DECÍA DOS COSAS FALSAS. Decía «No puedes
// gestionar NI RECIBIR NUEVAS ASIGNACIONES hasta resolver tu cierre pendiente», y este comentario
// remataba con «el bloqueo abarca gestionar Y recibir»:
//   · «ni recibir nuevas asignaciones» es falso SIEMPRE — recibir no se bloquea en ningún estado
//     (pedido humano del 2026-08-18, ratificado por la regla firmada). Ninguna superficie de
//     asignación consulta el predicado de bloqueo.
//   · «No puedes gestionar» es falso con `solicitado` — pero eso ya no llega hasta aquí: el flag
//     `bloqueado` sólo se enciende con `vencido`/`rechazado` (ver su doc en las props).
// Un aviso que prohíbe MÁS de lo que el servidor rechaza es peor que no avisar: el mensajero deja
// de intentar cosas que sí puede hacer, y el trabajo que le siguen asignando se le queda parado.
//
// Es la SEGUNDA copia del texto; la primera vive en `lib/constants/bloqueo-mensajero.ts` para los
// dos portales ("Entregas" y "Recolección"). NO se importa de allí a propósito: esa variante
// remata con «Ve a «Cierre del día» para resolverlo» y aquí el mensajero YA está en esa pantalla,
// con el CTA del vencido/rechazado a la vista. Lo único que se comparte es el criterio: decir qué
// NO puede, qué SÍ puede, y cómo salir.
//
// Qué NO repite: el «envíalo a aprobación» y el porqué del estado los dicen `VENCIDO_AVISO` /
// `RECHAZADO_AVISO` justo debajo, cada uno con su CTA. Lo que ninguno de los dos dice —y es lo que
// aporta éste— es el ALCANCE: qué significa exactamente «tu operación» bloqueada.
const BLOQUEO_AVISO =
  "No puedes gestionar entregas ni cobrar hasta resolver tu cierre. Sí puedes seguir recibiendo asignaciones: te esperan en «Entregas». Resuélvelo con el botón de abajo.";

// Feature 111/R13: CTA + aviso del cierre `vencido` (texto separado, i18n-ready).
//
// FEATURE 241 (2026-08-20) — REVISADO CON LA REGLA NUEVA DELANTE, Y SOBREVIVE TAL CUAL. Se miro
// por lo mismo que hundio a `RECHAZADO_AVISO` de aqui abajo, y sale limpio en los dos frentes:
//   · CUANDO SE LEVANTA EL BLOQUEO: dice «envialo a aprobacion PARA DESTRABAR tu operacion», o sea
//     que destraba AL ENVIAR. Es exactamente lo que hace el codigo — `transicionarVencidoASolicitado`
//     escribe `estado = 'solicitado'` y `solicitado` NO esta en `ESTADOS_CIERRE_BLOQUEAN_GESTION`,
//     asi que el mensajero sale del conjunto bloqueado en esa misma escritura.
//   · ASIGNACIONES: no las menciona, que es lo correcto — recibir no se bloquea nunca.
// Queda anotado para que la proxima revision no tenga que re-litigarlo: NO es un olvido, esta
// comprobado contra el predicado.
const VENCIDO_AVISO =
  "Tienes un cierre vencido sin resolver. Envíalo a aprobación para destrabar tu operación.";
const VENCIDO_CTA_LABEL = "Solicitar aprobación del cierre vencido";
const VENCIDO_CONFIRM_TITULO = "Solicitar aprobación del cierre vencido";
const VENCIDO_CONFIRM_DETALLE =
  "Se enviará tu cierre vencido a tu bodega para aprobación. No se recalculan los montos ya registrados.";
const VENCIDO_OK = "Cierre vencido enviado a aprobación.";

// Feature 109/R31: CTA + aviso del cierre `rechazado` (texto separado, i18n-ready).
// En el modelo GLOBAL un cierre `rechazado` NO es terminal: bloquea, y es RE-SOLICITABLE (espejo
// del `vencido`). El copy lo deja explícito para que no se lea como "resuelto/cerrado".
//
// ⚠️ FEATURE 241 (2026-08-20) — DECÍA QUE EL BLOQUEO DURABA MÁS DE LO QUE DURA, Y ESA DIRECCIÓN DEL
// ERROR ES LA CARA. Remataba con «sigue bloqueando tu operación hasta que lo vuelvas a enviar a
// aprobación Y TU BODEGA LO APRUEBE». Falso: `transicionarRechazadoASolicitado` escribe
// `estado = 'solicitado'`, y `solicitado` NO está en `ESTADOS_CIERRE_BLOQUEAN_GESTION`
// (`["vencido","rechazado"]`) — el único predicado que gatea gestionar y cobrar, y el que consultan
// `MisAsignacionesService`, `CierreDiaService.deshacerGestion` y `RecoleccionTiendaService`. O sea:
// el bloqueo se levanta EN ESA MISMA ESCRITURA, sin que la bodega toque nada.
//
// Prometer una espera que no existe no es un matiz de redacción: manda al mensajero a esperar de
// brazos cruzados una aprobación que no necesita para volver a trabajar —mediana 8,2 h, p90 22,1 h—
// y es una pérdida de jornada silenciosa, sin ningún síntoma que la delate.
//
// Lo que NO se prometió a cambio: que reenviar le devuelva las órdenes congeladas. La liberación de
// `sin_gestionar` sí ocurre solo al APROBAR (109/R16, `CierresAdminService`), así que el texto habla
// de lo que recupera —gestionar y cobrar— y no de recuperar las órdenes.
const RECHAZADO_AVISO =
  "Tu cierre fue rechazado, pero no queda cerrado. Vuelve a enviarlo a aprobación: con eso se levanta el bloqueo y sigues gestionando y cobrando, sin esperar a que tu bodega lo apruebe.";
const RECHAZADO_CTA_LABEL = "Solicitar aprobación del cierre rechazado";
const RECHAZADO_CONFIRM_TITULO = "Solicitar aprobación del cierre rechazado";
const RECHAZADO_CONFIRM_DETALLE =
  "Se enviará de nuevo tu cierre rechazado a tu bodega para aprobación. No se recalculan los montos ya registrados.";
const RECHAZADO_OK = "Cierre rechazado enviado a aprobación.";

// Pedido humano: "ver" el detalle de un cierre YA solicitado (textos separados, i18n-ready).
const VER_DETALLE_LABEL = "Ver";
const DETALLE_TITULO = "Detalle del cierre";
const DETALLE_CARGANDO = "Cargando el detalle…";
const DETALLE_ERROR = "No se pudo cargar el detalle de este cierre.";
const DETALLE_NO_ENCONTRADA = "Este cierre ya no está disponible.";
const DETALLE_NOTA =
  "Los montos son los que quedaron congelados al solicitar el cierre.";

/** Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready). */
const PAGO_MENSAJERO_LABEL = "Ganancia";
const PAGO_MENSAJERO_COL = "Ganancia";

// Feature 67 (R35-R38): textos del deshacer (separados de la lógica, i18n-ready).
const DESHACER_COL = "Acciones";
const DESHACER_LABEL = "Devolver a gestión";
const DESHACER_TITULO = "Devolver la orden a gestión";
const DESHACER_DETALLE =
  "La gestión quedará anulada (queda el registro de quién la hizo y cuándo) y la orden volverá a tu lista para gestionar.";
const DESHACER_OK = "Gestión deshecha; la orden volvió a tu lista para gestionar.";
const DESHACER_FORBIDDEN = "No podés deshacer esta gestión.";
const DESHACER_ERROR = "No se pudo deshacer la gestión. Intentá de nuevo.";

// =================================================================================================
// FEATURE 237 (D3 firmada por el humano, R38) — «DEVOLVER A GESTION» NO SE OFRECE SOBRE LO QUE
// REGISTRO LA TIENDA.
// =================================================================================================
//
// **El defecto que cierra, encontrado VIENDO LA APP y no por la suite** (2026-08-20, recorrido T9.1):
// el boton salia HABILITADO en la fila de una gestion de la tienda, abria su modal —que promete «la
// orden volvera a tu lista para gestionar»— y el servidor lo rechazaba, correctamente, por la
// guardia 3-bis de `CierreDiaService.deshacerGestion`. O sea: un boton que SIEMPRE falla, detras de
// un modal que afirma lo que no va a pasar. Es la misma clase de defecto que la 235 quito de esta
// pila («dejarlo seria un boton que siempre falla»), aqui del reves: no es un permiso sin
// superficie, es una superficie sin permiso.
//
// **Por que DESHABILITADO CON SU MOTIVO y no oculto.** Ocultarlo deja la fila mas limpia, pero un
// control que desaparece sin explicacion hace que el mensajero se pregunte por que en unas filas si
// y en otras no — y esa pregunta es exactamente la que la marca «La tienda» de la fila acaba de
// empezar a responder: la fila ya dice QUIEN la registro; decir aqui POR QUE no puede tocarla cierra
// el razonamiento en el mismo sitio. Ademas es el tratamiento que ESTA MISMA PANTALLA ya usa para
// «no podes, y este es el motivo»: el boton «Solicitar cierre» va `disabled` con `motivoBloqueo` en
// su `title`. Y mantiene la columna «Acciones» alineada: todas las filas tienen su control en el
// mismo sitio, una de ellas apagada — un «—» suelto entre botones se lee peor.
//
// **El motivo viaja tambien en el NOMBRE ACCESIBLE, no solo en `title`.** Un boton `disabled` sale
// del orden de tabulacion, asi que su tooltip es inalcanzable con el teclado; poniendolo tambien en
// el nombre, quien navega con lector de pantalla lo lee al recorrer la tabla. Misma tecnica que la
// marca de la fila (`GESTION_TIENDA_BADGE_NOTA`).
//
// ⚠️ EL TEXTO ES EL MISMO que devuelve el servidor si alguien llega a la accion por otra via
// (`MSG_GESTION_DE_LA_TIENDA`, `lib/services/CierreDiaService.ts`). Esta duplicado a proposito y hay
// que decirlo: esa constante NO se exporta y traerla aqui arrastraria Prisma al navegador. Con el
// boton apagado el mensaje del servidor es practicamente inalcanzable desde esta pantalla, asi que
// el riesgo de que divergan es bajo — pero si alguien cambia uno, tiene que cambiar el otro: son
// las dos mitades de la MISMA regla, dicha antes y despues.
const DESHACER_BLOQUEO_TIENDA =
  "Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella puede corregirlo. Escribile por el chat de la orden.";

/** Nombre accesible del botón de la fila (R35): identifica SU orden, no el botón genérico. */
function deshacerAriaLabel(g: CierreDetalleGestion): string {
  return `${DESHACER_LABEL} la orden ${g.numRemision} · ${g.destinatario}`;
}

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
//
// Feature 170 (T E.4): `RESULTADO_LABEL`, las etiquetas de método, `ESTADO_LABEL` y
// `DESTINO_LABEL` estaban DUPLICADAS palabra por palabra aquí y en `cierre-detalle-shared`.
// (Feature 213: las de método ya solo se leen desde `desglose-pago`.) Ahora las dos
// pantallas —y el archivo de la descarga, que no puede importar React— leen del módulo PURO
// `cierre-labels`. Ni un texto cambió; lo que cambia es que ya no pueden divergir (R8).

const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
  incidente: "No hay incidentes.", // feature 158/R18
};

const DESTINO_LABEL: Record<CierreDestinoTipo, string> = DESTINO_TIPO_LABEL;

/**
 * Orden fijo de las secciones (R3). Feature 158/R18: los `incidente` son un grupo PROPIO y
 * van AL FINAL, después de los cuatro desenlaces normales — el mismo criterio que en el paso
 * de resultados del panel del mensajero: no es una forma más de terminar la entrega.
 */
const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

/**
 * Feature 170 (T E.4) — columnas y proyección de export POR RESULTADO, en el mismo orden de
 * las secciones. UNA DESCARGA POR SECCIÓN (decisión del humano, P2 ratificada): cada
 * resultado enseña columnas distintas, así que un archivo único sería media hoja vacía.
 *
 * El mapa vive aquí y no en el módulo de columnas porque un `Record` exportado desde un
 * `*-descarga-columnas.ts` se le escaparía a la guardia de datos sensibles, que solo
 * reconoce arrays de columnas y funciones de proyección.
 */
const DESCARGA_POR_RESULTADO: Record<
  CierreResultado,
  { columnas: DescargaColumna[]; fila: (g: CierreDetalleGestion) => DescargaFila }
> = {
  entregada: {
    columnas: COLUMNAS_DESCARGA_DIA_ENTREGADAS,
    fila: filaDescargaDiaEntregada,
  },
  reprogramada: {
    columnas: COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
    fila: filaDescargaDiaReprogramada,
  },
  devuelta: {
    columnas: COLUMNAS_DESCARGA_DIA_DEVUELTAS,
    fila: filaDescargaDiaDevuelta,
  },
  rechazada: {
    columnas: COLUMNAS_DESCARGA_DIA_RECHAZADAS,
    fila: filaDescargaDiaRechazada,
  },
  incidente: {
    columnas: COLUMNAS_DESCARGA_DIA_INCIDENTES,
    fila: filaDescargaDiaIncidente,
  },
};

/** Nombre visible del histórico: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA_PASADOS = "Cierres solicitados";
/** Nombre accesible del control de paginación (R43). */
export const PAGINACION_PASADOS_LABEL = "Paginación de los cierres solicitados";
const ERROR_PASADOS = "No se pudieron cargar tus cierres solicitados.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreConfig.MAX_PAGE_SIZE);

/**
 * Feature 170 — FASE 2 (T I.2, R40/R41/R44): una página de los cierres solicitados POR ESTE
 * mensajero. El `mensajero_id` no viaja en el input: lo pone el servidor desde la sesión, así
 * que no hay parámetro por el que pedir el histórico de otro.
 */
async function leerCierresPasados(
  page: number,
  pageSize: number,
): Promise<CierresPasadosPagina> {
  const res = await listarCierresPasadosPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// Feature 201 (tanda C) — aquí vivía una copia LOCAL (no exportada) del mismo `money` que las
// otras siete pantallas de dinero: money-safe, sí, pero también la razón de que el cierre del
// mensajero enseñara `₡13331832.72`. Ahora sale de `lib/config/moneda.ts`, igual que en el
// detalle del admin, que es la MISMA hoja vista desde el otro lado (R6/R7 intactos: el monto
// llega como STRING y NUNCA se parsea a número).

/** Une la jerarquía geográfica en una línea legible (omite los vacíos, R4). */
function ubicacion(g: CierreDetalleGestion): string {
  return [g.zonaNombre, g.provinciaNombre, g.cantonNombre, g.distritoNombre]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

export function CierreDiaModule({
  grupos,
  totales,
  totalPagoMensajero,
  puedesSolicitar,
  motivoBloqueo,
  cierresPasados,
  bloqueado,
  tieneVencido,
  tieneRechazado,
}: CierreDiaModuleProps) {
  const router = useRouter();
  const toast = useToast();
  const { mutate } = useSWRConfig();

  // Confirmación de "Solicitar cierre"; true = modal abierto.
  const [confirmar, setConfirmar] = useState(false);
  // Feature 111/R13: confirmación del CTA del cierre `vencido`; true = modal abierto.
  const [confirmarVencido, setConfirmarVencido] = useState(false);
  // Feature 109/R31: confirmación del CTA del cierre `rechazado`; true = modal abierto.
  const [confirmarRechazado, setConfirmarRechazado] = useState(false);
  // Evidencia (URL firmada, R5) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Feature 67/R36: fila pendiente de confirmar el deshacer; null = modal cerrado.
  const [deshacerFila, setDeshacerFila] = useState<CierreDetalleGestion | null>(
    null,
  );
  // Feature 67: gestionId del deshacer EN VUELO; deshabilita el botón de ESA fila
  // (anti-doble-submit en la UI; el WHERE guardado del repo lo cubre igual).
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null);
  // Pedido humano: cierre pasado ABIERTO en el visor de detalle; null = modal cerrado. El
  // detalle se pide bajo demanda (no viaja en las props de la página: son N cierres).
  const [cierreAbierto, setCierreAbierto] = useState<CierrePasadoDTO | null>(null);
  // Feature 264 (Q1/R30): el estado guardaba SOLO `grupos` y ahora guarda también las órdenes
  // sin gestionar y su marca. Van juntos en un objeto y no en tres `useState` sueltos porque
  // los tres llegan de la MISMA lectura: separarlos permitiría un render con la lista de un
  // cierre y los grupos de otro.
  const [detallePasado, setDetallePasado] = useState<DetalleCierrePasado | null>(
    null,
  );
  const [detalleError, setDetalleError] = useState<string | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  /**
   * Pedido humano del 2026-08-19 — solicitar el cierre tiene que verse en «Cierres
   * solicitados» sin recargar. `router.refresh()` a secas no alcanzaba: re-resuelve el Server
   * Component, pero su página entra en el `useSWR` de abajo como `fallbackData`, que SWR usa
   * una vez y no vuelve a consultar; con datos ya en caché, el cierre recién solicitado no
   * aparecía. Se revalidan todas las páginas de la lista, no sólo la visible.
   */
  function refrescarListas() {
    void mutate((clave) => Array.isArray(clave) && clave[0] === "cierre-dia:pasados");
    router.refresh();
  }

  /** Abre el visor de un cierre pasado y carga su detalle (solo lectura). */
  async function abrirDetalle(cierre: CierrePasadoDTO) {
    setCierreAbierto(cierre);
    setDetallePasado(null);
    setDetalleError(null);
    setCargandoDetalle(true);
    try {
      const result = await verCierrePasado({ cierreId: cierre.cierreId });
      if (result.status === "ok") {
        setDetallePasado({
          grupos: result.grupos,
          // Feature 264 (R30): el mismo par de campos que el detalle del admin, por el mismo
          // camino. No es plata de la empresa —la lista no tiene ni un importe—, así que la
          // regla de audiencia de la 38/40 no aplica: son SUS órdenes.
          ordenesSinGestion: result.ordenesSinGestion,
          sinGestionRegistrado: result.sinGestionRegistrado,
        });
        return;
      }
      // `no_encontrada` = el cierre ya no existe o no es suyo (no se distinguen, igual que
      // en el servidor); el resto son fallos de borde y comparten mensaje accionable.
      setDetalleError(
        result.status === "no_encontrada" ? DETALLE_NO_ENCONTRADA : DETALLE_ERROR,
      );
    } finally {
      setCargandoDetalle(false);
    }
  }

  // Feature 170 — FASE 2 (T I.2, R40/R43): página visible de «Cierres solicitados».
  // `fallbackData` es la página que ya resolvió el Server Component: al entrar no hay segunda
  // lectura y las filas son EXACTAMENTE las de antes (R44).
  const [pasadosPage, setPasadosPage] = useState(1);
  const [pasadosPageSize, setPasadosPageSize] = useState(cierresPasados.pageSize);
  const { data: pasadosData, error: pasadosError } = useSWR(
    ["cierre-dia:pasados", pasadosPage, pasadosPageSize],
    () => leerCierresPasados(pasadosPage, pasadosPageSize),
    {
      fallbackData:
        pasadosPage === 1 && pasadosPageSize === cierresPasados.pageSize
          ? cierresPasados
          : undefined,
    },
  );

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const pasadosCargando = pasadosData === undefined;

  /**
   * Feature 37 + 111/R13 + 109/R31: envía el cierre. Un mismo camino sirve para
   * "Solicitar cierre" (crea) y los CTA de re-solicitud del `vencido`/`rechazado`
   * (transiciones vencido→solicitado / rechazado→solicitado): el backend enruta según
   * el estado abierto del mensajero. El toast distingue por `via` (P2). Cierra los tres
   * modales pase lo que pase.
   */
  async function confirmarSolicitud() {
    const result = await solicitarCierre();
    if (result.status === "ok") {
      toast.success(
        result.via === "vencido_solicitado"
          ? VENCIDO_OK
          : result.via === "rechazado_solicitado"
            ? RECHAZADO_OK
            : "Cierre solicitado correctamente.",
      );
      setConfirmar(false);
      setConfirmarVencido(false);
      setConfirmarRechazado(false);
      refrescarListas();
      return;
    }
    const mensaje =
      result.status === "conflict" || result.status === "validation_error"
        ? mensajeError(result, "No se pudo solicitar el cierre.")
        : result.status === "forbidden"
          ? "No tenés permiso para solicitar el cierre."
          : "No se pudo solicitar el cierre. Intentá de nuevo.";
    toast.error(mensaje);
    setConfirmar(false);
    setConfirmarVencido(false);
    setConfirmarRechazado(false);
  }

  /**
   * Feature 67/R36-R38: ejecuta el deshacer ya confirmado. `ok` → toast + `router.refresh()`
   * (R37: la vista releé el estado del SERVIDOR; la fila desaparece y los totales se
   * recalculan allá, nunca se mutan acá). Error → toast accionable y NI la tabla NI los
   * totales se tocan (R38): no hay refresh y las filas siguen siendo las props del padre.
   */
  async function confirmarDeshacer() {
    const fila = deshacerFila;
    if (!fila) return;
    setDeshaciendo(fila.gestionId);
    const result = await deshacerGestion({ gestionId: fila.gestionId });
    if (result.status === "ok") {
      toast.success(DESHACER_OK);
      setDeshacerFila(null);
      // `deshaciendo` NO se limpia: la fila se va con el refresh y su botón se
      // desmonta; re-habilitarlo solo abriría la ventana a un segundo envío que el
      // server rechazaría con "esta gestión ya fue deshecha" (R3).
      refrescarListas();
      return;
    }
    const mensaje =
      result.status === "conflict" || result.status === "validation_error"
        ? // R38: el `motivo` del conflict YA viene accionable del server (no se reescribe acá).
          mensajeError(result, DESHACER_ERROR)
        : result.status === "forbidden"
          ? DESHACER_FORBIDDEN
          : DESHACER_ERROR;
    toast.error(mensaje);
    setDeshaciendo(null);
    setDeshacerFila(null);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Aviso de bloqueo para gestionar y cobrar (feature 41/R21 + 111/R12 → 241) ----
          Se pinta con el booleano tal cual llega del servidor: `bloqueado` YA significa
          «vencido o rechazado» (241), así que un cierre `solicitado` no entra por aquí y no hay
          nada que filtrar en el cliente. Va antes que los CTA del vencido/rechazado porque enuncia
          el ALCANCE del bloqueo; el «qué hacer» y su botón vienen justo debajo. */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {BLOQUEO_AVISO}
        </p>
      ) : null}

      {/* ---------- CTA del cierre vencido (feature 111/R13) ----------
          Se ofrece SIEMPRE que haya un `vencido`, con INDEPENDENCIA del gate de
          creación (`puedesSolicitar`): solicitar el vencido es la vía para destrabar
          la operación. Llama a la MISMA action `solicitarCierre()`; el backend la
          enruta a la transición vencido→solicitado. */}
      {tieneVencido ? (
        <section
          aria-label="Cierre vencido"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm text-destructive">{VENCIDO_AVISO}</p>
          <Button
            type="button"
            variant="destructive"
            className="w-fit"
            onClick={() => setConfirmarVencido(true)}
          >
            {VENCIDO_CTA_LABEL}
          </Button>
        </section>
      ) : null}

      {/* ---------- CTA del cierre rechazado (feature 109/R31) ----------
          Mismo patrón que el `vencido` (mismo action `solicitarCierre()` → el backend
          enruta a la transición rechazado→solicitado). Se ofrece SIEMPRE que haya un
          `rechazado`, con INDEPENDENCIA del gate de creación (`puedesSolicitar`). El copy
          comunica que un `rechazado` NO es terminal: bloquea hasta re-solicitar + aprobar. */}
      {tieneRechazado ? (
        <section
          aria-label="Cierre rechazado"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm text-destructive">{RECHAZADO_AVISO}</p>
          <Button
            type="button"
            variant="destructive"
            className="w-fit"
            onClick={() => setConfirmarRechazado(true)}
          >
            {RECHAZADO_CTA_LABEL}
          </Button>
        </section>
      ) : null}

      {/* ---------- Panel de totales por método de pago (R7) ---------- */}
      <section aria-label="Totales del día" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Totales del día</h2>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <TotalItem label="Efectivo" value={money(totales.efectivo)} />
            <TotalItem label="SINPE" value={money(totales.simpe)} />
            <TotalItem
              label="Transferencia"
              value={money(totales.transferencia)}
            />
            <TotalItem label="Total general" value={money(totales.general)} emphasis />
          </CardContent>
        </Card>
      </section>

      {/* ---------- Ganancia (R11): total SEPARADO del dinero recibido ---------- */}
      <section aria-label={PAGO_MENSAJERO_LABEL} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{PAGO_MENSAJERO_LABEL}</h2>
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <span className="text-sm font-medium text-muted-foreground">
              Total de ganancia
            </span>
            <span className="text-lg font-semibold">
              {money(totalPagoMensajero)}
            </span>
          </CardContent>
        </Card>
      </section>

      {/* ---------- Secciones por resultado (R3/R4/R5/R6) ---------- */}
      {ORDEN_RESULTADOS.map((resultado) => {
        const filas = grupos[resultado] ?? [];
        // Pedido: no mostrar las secciones sin registros (p. ej. reprogramadas con 0).
        if (filas.length === 0) return null;
        return (
          <section
            key={resultado}
            aria-label={RESULTADO_LABEL[resultado]}
            className="flex flex-col gap-3"
          >
            <h2 className="text-lg font-semibold">
              {RESULTADO_LABEL[resultado]}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({filas.length})
              </span>
            </h2>
            <div className="overflow-x-auto">
              <DataTable
                columns={columnasPara(
                  resultado,
                  setEvidencia,
                  setDeshacerFila,
                  deshaciendo,
                )}
                data={filas}
                rowKey="gestionId"
                ariaLabel={RESULTADO_LABEL[resultado]}
                emptyMessage={RESULTADO_VACIO[resultado]}
                /**
                 * Feature 170 (T E.4, R1/R8/R11/R22/R26/R30/R37) — una descarga POR SECCIÓN.
                 * Familia B: `filas` es el grupo completo que ya llegó por props, así que el
                 * archivo sale de lo que la tabla pinta, en su mismo orden y sin releer.
                 * La URL firmada de la evidencia no viaja: la columna es un «Sí/No» (R22).
                 */
                descarga={{
                  titulo: RESULTADO_LABEL[resultado],
                  columnas: DESCARGA_POR_RESULTADO[resultado].columnas,
                  obtenerFilas: () =>
                    filasLocales(filas, DESCARGA_POR_RESULTADO[resultado].fila),
                }}
              />
            </div>
          </section>
        );
      })}

      {/* ---------- Solicitar cierre (R10/R11) ---------- */}
      <section aria-label="Solicitar cierre" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!puedesSolicitar}
            title={!puedesSolicitar ? motivoBloqueo ?? undefined : undefined}
            aria-describedby={
              !puedesSolicitar && motivoBloqueo ? "motivo-bloqueo" : undefined
            }
          >
            Solicitar cierre
          </Button>
        </div>
        {!puedesSolicitar && motivoBloqueo ? (
          <p
            id="motivo-bloqueo"
            role="note"
            className="text-sm text-muted-foreground"
          >
            {motivoBloqueo}
          </p>
        ) : null}
      </section>

      {/* ---------- Cierres solicitados (histórico, solo lectura, R18) ---------- */}
      <section aria-label="Cierres solicitados" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cierres solicitados</h2>
        {/* Pedido humano del 2026-08-16: la descarga dejó de vivir dentro de la lista y la
            monta la pantalla. Aquí no hay pestañas con las que alinearla, así que se queda
            donde estaba —encima del listado, a la derecha—, con el mismo nombre accesible.

            Feature 170 (T I.2, R52) — el listado pinta UNA página; el archivo sigue siendo el
            CONJUNTO COMPLETO de ESTE mensajero, y ese acotamiento lo resuelve el servidor desde
            la sesión: descargar no puede traer los cierres de otro (R44). Feature 184 — Tanda C
            (T C.2, R1/R2/R6/R9): ese conjunto lo entrega una lectura DEDICADA, que cuesta una
            consulta, cero firmas de evidencia y con el tope de filas evaluado en el servidor. */}
        <div className="flex flex-wrap items-start justify-end gap-2">
          <DescargarDatasetButton
            titulo={TITULO_DESCARGA_PASADOS}
            columnas={COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS}
            obtenerFilas={() =>
              filasDesdeResultado(
                listarCierresPasadosCompleto(),
                filaDescargaDiaCierrePasado,
              )
            }
          />
        </div>
        {/* Cada cierre solicitado se lee como su COMPROBANTE, la misma hoja que el mensajero
            ya veía al abrir el detalle —y la que el admin mira para decidirlo—. El botón
            conserva el nombre accesible que tenía en la columna «Ver detalle»: es el mismo
            gesto y lo localizan igual los tests y el E2E. */}
        <ListaComprobantes
          ariaLabel={TITULO_DESCARGA_PASADOS}
          items={pasadosData?.items ?? []}
          clave={(c) => c.cierreId}
          isLoading={pasadosCargando}
          error={pasadosError ? ERROR_PASADOS : null}
          emptyMessage="Aún no has solicitado ningún cierre."
          render={(c) => (
            <CierreFacturaResumenPropio
              cierre={c}
              acciones={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${VER_DETALLE_LABEL} del cierre del ${c.solicitadoAt.slice(0, 10)}`}
                  onClick={() => abrirDetalle(c)}
                >
                  {VER_DETALLE_LABEL}
                </Button>
              }
            />
          )}
        />

        <Pagination
          page={pasadosPage}
          pageSize={pasadosPageSize}
          total={pasadosData?.total ?? 0}
          disabled={pasadosCargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_PASADOS_LABEL}
          onPageChange={setPasadosPage}
          onPageSizeChange={(s) => {
            setPasadosPageSize(s);
            setPasadosPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </section>

      {/* Confirmación de "Solicitar cierre". */}
      <Modal
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Solicitar cierre del día"
        description="Se agruparán todas tus gestiones pendientes en una solicitud de cierre. Esta acción no se puede deshacer."
        confirmLabel="Solicitar cierre"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 111/R13: confirmación del CTA del cierre vencido (differente del
          "Solicitar cierre" del día). Misma action; el backend transiciona el vencido. */}
      <Modal
        open={confirmarVencido}
        onOpenChange={setConfirmarVencido}
        title={VENCIDO_CONFIRM_TITULO}
        description={VENCIDO_CONFIRM_DETALLE}
        confirmLabel="Solicitar aprobación"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 109/R31: confirmación del CTA del cierre rechazado (espejo del vencido).
          Misma action; el backend transiciona rechazado→solicitado. */}
      <Modal
        open={confirmarRechazado}
        onOpenChange={setConfirmarRechazado}
        title={RECHAZADO_CONFIRM_TITULO}
        description={RECHAZADO_CONFIRM_DETALLE}
        confirmLabel="Solicitar aprobación"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 67/R36: confirmación explícita del deshacer (una sola por módulo,
          parametrizada con la fila elegida: el Modal ya es un focus-trap accesible). */}
      <Modal
        open={deshacerFila !== null}
        onOpenChange={(next) => {
          if (!next) setDeshacerFila(null);
        }}
        title={DESHACER_TITULO}
        description={
          deshacerFila
            ? `Orden ${deshacerFila.numRemision} · ${deshacerFila.destinatario}. ${DESHACER_DETALLE}`
            : undefined
        }
        confirmLabel={DESHACER_LABEL}
        onConfirm={confirmarDeshacer}
        closeOnConfirm={false}
      />

      {/* Pedido humano: visor SOLO LECTURA del detalle de un cierre pasado. Mismas secciones
          por resultado que la vista del día, sin la columna de acciones: un cierre ya
          solicitado no se deshace desde aquí. */}
      <Modal
        open={cierreAbierto !== null}
        onOpenChange={(next) => {
          if (!next) setCierreAbierto(null);
        }}
        title={DETALLE_TITULO}
        description={
          cierreAbierto
            ? `${ESTADO_LABEL[cierreAbierto.estado]} · ${cierreAbierto.solicitadoAt.slice(0, 10)} · ${DESTINO_LABEL[cierreAbierto.destinoTipo]}`
            : undefined
        }
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setCierreAbierto(null)}
      >
        {cierreAbierto ? (
          <div className="flex flex-col gap-4">
            {cargandoDetalle ? (
              <p role="status" className="text-sm text-muted-foreground">
                {DETALLE_CARGANDO}
              </p>
            ) : null}
            {detalleError ? (
              <p role="alert" className="text-sm text-destructive">
                {detalleError}
              </p>
            ) : null}
            {detallePasado ? (
              <>
                {/* MISMO comprobante que usa el admin (`CierreFacturaDetalle`), en su
                    variante `mensajero`: sin el ingreso de Ordenex ni la liquidación (no es
                    plata suya, design §7.2) y con lo recibido + su pago en los renglones. */}
                <CierreFacturaDetalle
                  audiencia="mensajero"
                  cierre={{
                    cierreId: cierreAbierto.cierreId,
                    estado: cierreAbierto.estado,
                    destinoTipo: cierreAbierto.destinoTipo,
                    totales: cierreAbierto.totales,
                    totalPagoMensajero: cierreAbierto.totalPagoMensajero,
                    totalIngresoBodegaRechazos:
                      cierreAbierto.totalIngresoBodegaRechazos,
                    solicitadoAt: cierreAbierto.solicitadoAt,
                    resueltoAt: cierreAbierto.resueltoAt ?? null,
                    motivoRechazo: cierreAbierto.motivoRechazo ?? null,
                  }}
                  grupos={detallePasado.grupos}
                  // Feature 264 (R30): las MISMAS dos props que pasa el módulo del admin. El
                  // componente es UNO: pintarla en una pantalla y callarla en la otra es el
                  // arreglo a medias que se corrigió en la 263, y lo vigila
                  // `cierre-detalle-superficies.guardia.test.ts`.
                  ordenesSinGestion={detallePasado.ordenesSinGestion}
                  sinGestionRegistrado={detallePasado.sinGestionRegistrado}
                  onVerEvidencia={setEvidencia}
                />
                <p role="note" className="text-xs text-muted-foreground">
                  {DETALLE_NOTA}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Visor de evidencia (URL firmada, R5). */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title="Evidencia de la gestión"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica de la gestión"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

/**
 * Devuelve el mensaje accionable de un resultado de dominio de error. El `motivo` de un
 * `conflict` lo redacta el SERVER (ya es accionable): acá no se reescribe. `fallback` es
 * el texto de la operación que llama, para el caso degenerado de `fieldErrors` vacío.
 */
function mensajeError(
  result:
    | { status: "conflict"; motivo: string }
    | { status: "validation_error"; fieldErrors: Record<string, string[]> },
  fallback: string,
): string {
  if (result.status === "conflict") return result.motivo;
  const primero = Object.values(result.fieldErrors)[0]?.[0];
  return primero ?? fallback;
}

/** Ítem del panel de totales. */
function TotalItem({
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
        className={
          emphasis ? "text-lg font-semibold" : "text-base font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

// =================================================================================================
// FEATURE 237 (T7.5 — R41, D6 firmada por el humano) — LA FILA DICE QUIEN LA REGISTRO.
// =================================================================================================
//
// **El problema, dicho con lo que le pasa a una persona.** Desde la 237 la TIENDA puede resolver
// una orden que sigue en la moto del mensajero, y esa gestion se atribuye a el: entra en ESTE
// cierre, suma un intento y mueve el mismo dinero. Sin la marca, el mensajero firma su cierre del
// dia con una gestion que no hizo y una evidencia que no subio, y no puede explicarla si le
// preguntan. La orden, ademas, ya desaparecio de su portal (R40), asi que esta pantalla es el UNICO
// sitio donde la vuelve a ver.
//
// **Por que un `Badge` inline y no una columna propia.** Es el tratamiento que esta MISMA fila
// (`CierreDetalleGestion`) ya usa para marcar la excepcion sin pagar una columna en cada registro:
// `renderPagoMensajero` (56/R23) cuelga un badge del monto solo cuando falta la tarifa, con su nota
// en `title`/`aria-label`. No se inventa nada. La alternativa —una columna al estilo de
// `renderRechazoOrigen` (102/R9), que pinta badge en TODAS las filas— cuesta ancho en una tabla que
// ya tiene diez columnas y `overflow-x-auto`, y obligaria a rotular «Vos» veinte veces para marcar
// una. Aqui la marca viaja pegada al numero de guia, que es la celda mas corta y la primera que se
// lee.
//
// **Que significa que NO este el badge:** que la gestion la registro el mensajero. NO es «no lo
// se»: `desdeAyudaTienda` es obligatorio en el DTO y se deriva del historial, que nace en la MISMA
// transaccion que la gestion (ver `lib/utils/gestion-de-la-tienda-flag.ts`). La ausencia es una
// afirmacion, y por eso su test va emparejado con el de la presencia.

/** Rotulo de la marca. Dice QUIEN, no solo que la fila es distinta, y cabe en una celda apretada. */
export const GESTION_TIENDA_BADGE_LABEL = "La tienda";

/**
 * La nota accesible del badge (`title` + `aria-label`). El rotulo dice quien; la nota dice lo que el
 * mensajero necesita para explicarla si le preguntan: desde donde se hizo, que el motivo y la foto
 * no son suyos, y que aun asi cuenta en este cierre.
 */
export const GESTION_TIENDA_BADGE_NOTA =
  "Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son suyos. Cuenta en tu cierre igual.";

// --- Columnas comunes a TODAS las secciones (R4; feature 158: tambien al grupo `incidente`) ---
const COLUMNAS_COMUNES: Column<CierreDetalleGestion>[] = [
  {
    id: "numGuia",
    value: "Nº Guía",
    render: (g) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-semibold">{g.numGuia ?? "—"}</span>
        {g.desdeAyudaTienda ? (
          <Badge
            variant="secondary"
            title={GESTION_TIENDA_BADGE_NOTA}
            aria-label={GESTION_TIENDA_BADGE_NOTA}
          >
            {GESTION_TIENDA_BADGE_LABEL}
          </Badge>
        ) : null}
      </span>
    ),
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
 * Construye las columnas de una sección: las comunes (R4) + las específicas del
 * resultado (monto+método si entregada R6; fecha+motivo si reprogramada; motivo
 * si devuelta; motivo+evidencia si rechazada, R5) + la de acciones (67/R35). El
 * setter del visor de evidencia se inyecta para la columna de la sección
 * "Rechazadas"; el del deshacer, para la columna de acciones de las 4.
 */
function columnasPara(
  resultado: CierreResultado,
  verEvidencia: (url: string) => void,
  pedirDeshacer: (g: CierreDetalleGestion) => void,
  deshaciendo: string | null,
): Column<CierreDetalleGestion>[] {
  // Feature 39/R10: pago al mensajero DERIVADO por orden (money-safe STRING, tal cual).
  const columnaPago: Column<CierreDetalleGestion> = {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (g) => money(g.pagoMensajero),
  };
  // Feature 67/R35: "Devolver a gestión" por fila, en todas las tablas — feature 158/Q-D:
  // tambien en la del `incidente`, que SI se puede deshacer. NO hay estado
  // "no deshacible" que pintar: la vista solo lista gestiones dentro de la ventana
  // (`findGestionesPendientes` filtra `cierre_id IS NULL` + `anulada_at IS NULL`) y
  // son todas del actor (`/cierre-dia` es exclusivo del mensajero dueño, `page.tsx`
  // hace `notFound()` para el resto). Una gestión que sale de la ventana desaparece
  // de la tabla; una carrera la corta el server con `conflict` + motivo (R38).
  const columnaAcciones: Column<CierreDetalleGestion> = {
    id: "acciones",
    value: DESHACER_COL,
    render: (g) => {
      // Feature 237 (D3/R38): la gestion que registro LA TIENDA no la puede deshacer el mensajero.
      // El servidor lo rechaza igual (guardia 3-bis) — esto no es la defensa, es no ofrecer una
      // accion que solo puede acabar en error, y decir por que.
      const bloqueadaPorTienda = g.desdeAyudaTienda;
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={
            bloqueadaPorTienda
              ? `${deshacerAriaLabel(g)} — no disponible: ${DESHACER_BLOQUEO_TIENDA}`
              : deshacerAriaLabel(g)
          }
          title={bloqueadaPorTienda ? DESHACER_BLOQUEO_TIENDA : undefined}
          disabled={bloqueadaPorTienda || deshaciendo === g.gestionId}
          onClick={() => pedirDeshacer(g)}
        >
          {DESHACER_LABEL}
        </Button>
      );
    },
  };
  if (resultado === "entregada") {
    return [
      ...COLUMNAS_COMUNES,
      { id: "monto", value: "Monto", render: (g) => money(g.montoRecibido) },
      {
        id: "metodo",
        value: "Método",
        // Feature 213/R23: lo que se pinta sale del DESGLOSE, no del campo escalar.
        // Sin líneas, el mismo marcador de ausencia de siempre (R22).
        render: (g) => desglosePantalla(g.pagos) ?? "—",
      },
      columnaPago,
      columnaAcciones,
    ];
  }
  if (resultado === "reprogramada") {
    return [
      ...COLUMNAS_COMUNES,
      {
        id: "fechaReprogramacion",
        value: "Nueva fecha",
        render: (g) => g.fechaReprogramacion ?? "—",
      },
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaPago,
      columnaAcciones,
    ];
  }
  if (resultado === "devuelta") {
    return [
      ...COLUMNAS_COMUNES,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaPago,
      columnaAcciones,
    ];
  }
  // Feature 158/R17/R18: el `incidente` es un grupo PROPIO y NO lleva NINGUNA columna de
  // dinero — ni pago al mensajero (un incidente no se paga) ni el monto de la indemnización
  // (es plata que se le paga a la tienda, no al mensajero: no es suya y no la ve, design §7.2).
  // El backend lo garantiza en la CONSULTA: `WITH_DETALLE` ni siquiera selecciona la columna,
  // así que aquí `indemnizacion` es SIEMPRE `null` y no hay monto que pintar.
  //
  // La CAUSA sí llega y sí se muestra: es el hecho que el propio mensajero reportó, no dinero.
  // Sin esta columna, el `select` que el backend puso a propósito no lo vería nadie.
  //
  // Sí conserva la columna de acciones: un `incidente` SE PUEDE deshacer mientras no esté
  // vinculado a un cierre (Q-D/R14), por la misma vía que el resto de resultados.
  if (resultado === "incidente") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_CAUSA_INCIDENTE,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaEvidencia(verEvidencia),
      columnaAcciones,
    ];
  }
  // rechazada: motivo + evidencia firmada (R5)
  return [
    ...COLUMNAS_COMUNES,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    columnaEvidencia(verEvidencia),
    columnaPago,
    columnaAcciones,
  ];
}

/**
 * Columna de la evidencia FIRMADA (R5), compartida por `rechazada` y `incidente` (158/R18):
 * abre el visor con la URL que ya viene firmada del servidor, nunca el storage_path crudo.
 */
function columnaEvidencia(
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion> {
  return {
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
  };
}
