"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Label } from "@/components/ui/label";
import { rechazarNovedad } from "@/lib/actions/resolver-novedad";
import type { RechazarNovedadActionResult } from "@/lib/actions/resolver-novedad";
import { rechazarNovedadSchema } from "@/lib/types/rechazo-tienda";
import type { NovedadDTO } from "@/lib/types/novedad";

// =================================================================================================
// 💰 FEATURE 240 (T5.3, design §10.3 — R27/R28/R29/R31/R32, D5 y D10 firmadas) — LA VENTANA CON LA
// QUE LA TIENDA CIERRA UNA DEVOLUCIÓN COMO RECHAZADA.
// =================================================================================================
//
// **Lo que había aquí antes: nada, y ése es el defecto.** Desde el 2026-08-12 el botón de la fila
// —rotulado «Devolver» hasta el 2026-08-19 y «Rechazar» desde entonces— avisaba por
// `toast.info` y no mutaba nada. Dos semanas de MAQUETA con la suite entera en verde. Esta ventana
// es la mitad que faltaba: la que convierte el clic en una operación.
//
// **Qué se está firmando con un clic, y por eso el aviso de arriba no es cortesía.** El rechazo
// manual escribe una gestión sintética `rechazada` con `cierre_id` nulo, que el siguiente cierre del
// mensajero recoge; ese cierre le cobra a la tienda EL FLETE DE DEVOLUCIÓN más su IVA. Y **no se
// puede deshacer**: la gestión queda protegida por la guarda del deshacer del mensajero (D6), así
// que un rechazo equivocado no tiene marcha atrás desde ninguna pantalla. D10 (firmada) exige decir
// las dos cosas ANTES, con palabras y siempre visibles.
//
// ⚠️ **EL AVISO NOMBRA EL FLETE DE DEVOLUCIÓN, NO EL «cobro por rechazo».** Son dos importes con
// dueños distintos: el cobro por rechazo es INGRESO DE LA BODEGA (sale de la tarifa de zona+vehículo
// del mensajero y no está en el ledger de la tienda), mientras que lo que la tienda paga es el flete
// de devolución, de su propia tarifa. Decirle a la tienda que se cobra a sí misma el primero sería
// falso, y es un error que la 237 ya tuvo que corregir en su diseño el 2026-08-20: se escribe aquí
// para que nadie lo vuelva a escribir al revés.
//
// **El importe concreto NO va en el aviso** (D10): un número inventado en un aviso de dinero es peor
// que ninguno, y el que la tienda pagará depende de su tarifa vigente y de si la orden es de GAM.
// El aviso dice QUÉ se cobra y que es irreversible, que es lo que no se puede deducir de la
// pantalla.
//
// **Molde: `ReprogramarNovedadModal`** (feature 100), su hermana de esta misma card: el mismo
// `Modal` compartido, el mismo `confirmDisabled`, el mismo campo de texto. Y de la ventana de la 237
// se toma **la forma del desenlace**: el resultado se devuelve TAL CUAL al padre en vez de
// traducirlo aquí a éxito/fracaso, porque quien decide qué se dice y qué se relee es el módulo que
// tiene la lista.
//
// **SIN SELECTOR DE FOTOS (R13/D5, firmada), y es una decisión, no un olvido.** La evidencia de la
// 237 la aporta la tienda sobre un paquete que sigue en la moto del mensajero; aquí el paquete YA
// volvió y YA se escaneó físicamente al aprobar el cierre (238), así que pedirle una foto sería
// pedirle la foto de algo que no tiene delante.
//
// **No se comprueba aquí ningún permiso.** La ventana la monta `NovedadesModule`, dentro de una
// página que el servidor ya acotó a la administración de la tienda dueña, y la Server Action vuelve
// a autorizar por su cuenta. Una guarda de interfaz no protege un dato.

// --- Textos visibles (separados de la lógica, listos para i18n, como el resto del módulo) --------

/** D10: la ventana nombra la orden, no «la novedad» ni «el envío». */
export const RECHAZO_TITULO = "Rechazar la orden";

/**
 * D10 — el aviso fijo. Va ARRIBA, siempre visible y nunca en un tooltip: dice el precio y dice que
 * no hay vuelta atrás, que son las dos cosas que la tienda no puede deducir mirando la pantalla.
 * Y ofrece la salida: si lo que quiere es reintentar, «Reprogramar» está en la misma fila.
 *
 * ⚠️ **AQUÍ NO VA NINGUNA CIFRA, Y NO ES QUE FALTE.** Se escribe porque quien lea esto va a pensar
 * que sí y va a querer «completarlo»:
 *
 *  · **El importe existe y no es simbólico**, pero **depende de la tarifa de CADA TIENDA**. Lo
 *    medido el 2026-08-20 contra producción son TOPES, no precios: **₡2.600** es el máximo de
 *    `valor_flete_devuelto` entre las tarifas activas y **₡2.200** el máximo de la columna GAM.
 *    Escribir cualquiera de los dos aquí sería **falso para casi todas las tiendas**.
 *  · **La que rige no es ni siquiera la tarifa vigente hoy**, sino la que quedó **congelada en
 *    `cierre_detail`** cuando se aprobó el cierre que recoja esta gestión. Un número calculado en
 *    esta pantalla podría no ser el que acabe cobrándose.
 *  · **Poner el importe REAL exigiría que `NovedadDTO` lo trajera por orden**, desde esa tarifa
 *    congelada. Es otro cambio, con su propia decisión y su propia firma; **no entra aquí de
 *    tapadillo**.
 *
 * D10 lo dice con todas las letras: «un número inventado en un aviso de dinero es peor que ninguno».
 * Así que el aviso dice **QUÉ** se cobra —el flete de devolución, no el cobro de bodega por rechazo,
 * que es ingreso de la bodega— y que es irreversible, que es justo lo que no se puede deducir.
 */
export const RECHAZO_AVISO =
  "Esto le cobra a tu tienda el flete de devolución y no se puede deshacer. Si preferís volver a intentar la entrega, usá «Reprogramar».";

/** D10/D5: el motivo es OBLIGATORIO, y el rótulo lo dice sin la muleta del asterisco. */
export const RECHAZO_MOTIVO_LABEL = "Motivo del rechazo";

/**
 * Por qué se pide, dicho donde se pide. Es la única línea que explicará el cobro el día de la
 * primera disputa (D5), así que conviene que quien escribe sepa para qué sirve lo que escribe.
 */
export const RECHAZO_MOTIVO_AYUDA =
  "Queda guardado con la orden: es lo único que explicará esta decisión si alguien pregunta más adelante.";

/**
 * R29 — el bloqueo, CON PALABRAS. Un botón apagado dice QUE no se puede, no POR QUÉ; es la regla
 * que la ventana de la 238, el sub-modal de la 158 y la de la 237 ya siguen.
 */
export const RECHAZO_FALTA_MOTIVO = "Escribí el motivo para poder rechazar.";

/** D10: el éxito dice a dónde va la mercadería, no «Listo». */
export const RECHAZO_EXITO = "Orden rechazada. El paquete vuelve a tu bodega.";

/**
 * D10/R31 — la carrera perdida. El cron de plazo vencido pudo escalar la orden, o la bodega pudo
 * recuperarla, entre que la tienda abrió esta ventana y pulsó. En ese caso **no se escribió nada**
 * y la pantalla NO puede afirmar que rechazó.
 *
 * ⚠️ El texto lo pone la PANTALLA y no se toma del `motivo` que devuelve el servicio: ése es una
 * cadena técnica («la orden ya no esta en devuelta») pensada para un registro, sin tildes y con el
 * nombre interno del estado dentro. Mostrarla sería enseñarle a la tienda el vocabulario de la base
 * de datos.
 */
export const RECHAZO_CONFLICTO =
  "Esta orden ya no estaba en devolución, así que no se rechazó. Actualizá la pantalla.";

/** Los desenlaces que no son ni `ok` ni `conflict`, dichos de forma accionable. */
export const RECHAZO_ERROR_FORBIDDEN = "No tenés permiso para rechazar esta orden.";
export const RECHAZO_ERROR_NOT_FOUND = "No se encontró la orden.";
export const RECHAZO_ERROR_CONFIG =
  "Falta configuración del catálogo de estados. Contactá a un administrador.";
export const RECHAZO_ERROR_SESION = "Tu sesión expiró. Iniciá sesión de nuevo.";

/**
 * R10 — la orden está en devolución pero le falta la gestión de la que sale el mensajero.
 *
 * ⚠️ **UN ESTADO INALCANZABLE NO EXIME DE TENER SALIDA**, y ésta es la lección que este texto deja
 * escrita junto al código. La invariante se cumple: a `devuelta` sólo se llega aprobando el cierre
 * que contiene la gestión (239), y está **medido en producción el 2026-08-20 — 11 órdenes han
 * pasado por `devuelta` y las 11 tienen la suya**, ni una anulada. Pero el día que un dato se
 * tuerza —alguien mueve un `estatus_id` a mano, una migración a medias—, quien está delante de la
 * pantalla merece **un mensaje, no un botón mudo**. Y eso es exactamente lo que pasó en el
 * recorrido: sin este desenlace, la acción salía por `INTERNAL`, el borde lanzaba y la tienda
 * pulsaba «Rechazar» con su motivo escrito **sin ver absolutamente nada**.
 *
 * Tres cosas dice el texto, y las tres a propósito: **qué pasa** (le falta un registro, no «error
 * interno»), **que no es culpa suya** —porque el botón estaba habilitado y ella hizo todo bien— y
 * **qué hacer**, con el dato que el administrador va a pedirle. Ningún nombre de función: el
 * `SinGestionDevueltaError` del servidor va al registro, no a la pantalla.
 */
export const RECHAZO_SIN_GESTION_ORIGEN =
  "No se pudo rechazar: a esta orden le falta el registro de su devolución. No es algo que hayas " +
  "hecho mal —avisá a un administrador con el número de guía para que la revisen.";

/**
 * Los desenlaces que SALEN de esta ventana. `validation_error` no está: lo consume el propio modal
 * pintándolo junto al campo, con lo escrito intacto. Se excluye del tipo en vez de dejarlo pasar
 * para que el padre no tenga que escribir una rama que nunca se alcanza.
 */
export type DesenlaceRechazo = Exclude<
  RechazarNovedadActionResult,
  { status: "validation_error" }
>;

export interface RechazarNovedadModalProps {
  /**
   * Orden en la devolución anclada que se va a rechazar (snapshot). El padre monta la ventana SOLO
   * con una orden activa y con `key={orden.id}`, así que el motivo arranca vacío en cada apertura
   * sin un efecto de reinicio — un motivo heredado de la orden anterior acabaría explicando un cobro
   * que no le corresponde.
   */
  orden: NovedadDTO;
  onOpenChange: (open: boolean) => void;
  /**
   * Desenlace del envío, devuelto TAL CUAL al padre. No se traduce aquí a «éxito/fracaso»: la
   * diferencia entre `ok` y `conflict` es justo la que 236/D8 costó aprender sobre esta misma card
   * («Habilitar» afirmaba haber habilitado aunque la carrera dejara la orden quieta), y quien decide
   * qué se dice y qué se relee es el módulo que tiene la lista.
   */
  onResuelto: (resultado: DesenlaceRechazo) => void;
}

export function RechazarNovedadModal({
  orden,
  onOpenChange,
  onResuelto,
}: Readonly<RechazarNovedadModalProps>) {
  const motivoId = useId();
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | undefined>(undefined);

  // R29: lo que falta para poder confirmar. `trim()` porque una línea de espacios no explica nada,
  // y porque es lo mismo que el borde hace antes de validar: dos reglas distintas sobre el mismo
  // campo dejarían un botón encendido que la acción rechaza.
  const faltaMotivo = motivo.trim() === "";

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del botón para no llamar
    // a una operación de dinero con el formulario incompleto (patrón `GestionarDesdeAyudaModal`).
    if (faltaMotivo) return;

    // Se valida con EL MISMO schema del borde, así que la ventana no tiene una regla propia del
    // motivo que pueda divergir de la suya: el día que ese campo gane un tope, lo gana aquí sola.
    //
    // ⚠️ Se valida **sólo el campo que la persona controla**, no el objeto entero. El `ordenId` lo
    // pone esta pantalla desde el DTO; si no fuera un identificador válido, el problema no sería
    // del formulario y pintarlo junto al motivo diría una mentira («escribí el motivo» sobre un
    // motivo ya escrito). Ese campo lo valida el borde, que es donde es accionable.
    const parsed = rechazarNovedadSchema.shape.motivo.safeParse(motivo);
    if (!parsed.success) {
      setMotivoError(parsed.error.issues[0]?.message ?? RECHAZO_FALTA_MOTIVO);
      return;
    }
    setMotivoError(undefined);

    const res = await rechazarNovedad({ ordenId: orden.id, motivo: parsed.data });
    if (res.status === "validation_error") {
      // Se pinta junto al campo y la ventana NO se cierra (`closeOnConfirm={false}`): lo escrito
      // sigue ahí, que es lo que costaría volver a redactar.
      setMotivoError(res.fieldErrors.motivo?.[0] ?? RECHAZO_FALTA_MOTIVO);
      return;
    }
    onResuelto(res);
  }

  const guia = orden.numGuia !== null ? `guía ${orden.numGuia}` : "sin guía asignada";

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={RECHAZO_TITULO}
      // D10: la descripción dice qué pasa con el PAQUETE. La fila desaparece de la pantalla al
      // confirmar, y sin esta frase nada explicaría dónde quedó la mercadería.
      description={`El paquete de ${orden.destinatario} (${guia}) vuelve a tu bodega y la orden se cierra como rechazada.`}
      confirmLabel="Rechazar"
      // `destructive`: cierra la orden, cobra y no se puede deshacer.
      confirmVariant="destructive"
      confirmDisabled={faltaMotivo}
      onConfirm={handleConfirm}
      closeOnConfirm={false}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        {/* D10/R28 — EL PRECIO Y LA IRREVERSIBILIDAD, ARRIBA Y SIEMPRE VISIBLES. `role="note"` y no
            `alert`: no es la consecuencia de un error, es la condición de la acción, y un `alert`
            la volvería a anunciar en cada re-render mientras se escribe el motivo. */}
        <p
          role="note"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {RECHAZO_AVISO}
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={motivoId}>{RECHAZO_MOTIVO_LABEL}</Label>
          <p id={`${motivoId}-ayuda`} className="text-xs text-muted-foreground">
            {RECHAZO_MOTIVO_AYUDA}
          </p>
          <textarea
            id={motivoId}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            required
            aria-invalid={motivoError ? true : undefined}
            aria-describedby={`${motivoId}-ayuda`}
            aria-label={RECHAZO_MOTIVO_LABEL}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {motivoError ? (
            <p role="alert" className="text-sm text-destructive">
              {motivoError}
            </p>
          ) : null}
        </div>

        {/* R29 — el motivo del bloqueo, con TEXTO. Se lee la frase, no el `disabled`. */}
        {faltaMotivo ? (
          <p role="note" className="text-sm text-muted-foreground">
            {RECHAZO_FALTA_MOTIVO}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
