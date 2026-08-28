"use client";

import { useEffect, useId, useMemo, useState, type ChangeEvent } from "react";
import { X } from "lucide-react";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";
import { gestionarDesdeAyuda } from "@/lib/actions/gestion-desde-ayuda";
import {
  gestionarDesdeAyudaSchema,
  RESULTADOS_DESDE_AYUDA,
  type GestionarDesdeAyudaResult,
  type ResultadoDesdeAyuda,
} from "@/lib/types/gestion-desde-ayuda";
// Feature 276 (T12, R8): la MISMA lista de inclusión que usa la guarda del servidor. Módulo puro
// —sin Prisma en runtime, sin servicios, sin nada de `next`— y sin el UMBRAL dentro (R10): a esta
// ventana solo le llega el booleano ya decidido en `orden.enElTope`.
import { permitidoEnElTope } from "@/lib/types/tope-intentos";
import type { NovedadDTO } from "@/lib/types/novedad";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";

// =================================================================================================
// FEATURE 237 (T7.2, design §12.2 — R12/R13/R14/R25 de superficie) — LA VENTANA CON LA QUE LA
// TIENDA RESUELVE UNA ORDEN QUE SIGUE EN LA MOTO DEL MENSAJERO.
// =================================================================================================
//
// **Qué se está firmando con un clic, y por eso el aviso de arriba no es cortesía.** Lo que esta
// ventana registra NO es un trámite de escritorio: crea una gestión atribuida al MENSAJERO —
// `crearGestionDesdeAyuda` inserta la fila con el mensajero de la orden y `cierre_id` NULO, para
// que la vincule su siguiente cierre—, suma un intento de entrega y mueve dinero real.
//
// ⚠️ **EL DINERO DE UN RECHAZO SON DOS IMPORTES CON DUEÑOS DISTINTOS, y hasta el 2026-08-27 este
// bloque decía mal el primero:** afirmaba que «un rechazo cobra a la tienda el `cobroRechazado` de
// la tarifa». Es falso por las dos mitades, y su vecino `NovedadAcciones` ya decía lo contrario
// desde el 2026-08-20 — dos versiones del mismo hecho a dos archivos de distancia.
//
//   1. El `cobroRechazado` —hasta ₡1.000, media 400, medido el 2026-08-20 contra producción— NO se
//      le cobra a la tienda: es INGRESO DE LA BODEGA. Sale de `TarifaZonaMensajero.cobroRechazado`
//      (`db/schema.prisma`), que es la tarifa por zona+vehículo DEL MENSAJERO y no la de la tienda;
//      lo deriva `ingresoBodegaPorResultado` (`lib/utils/ingreso-bodega.ts`, «NUNCA se paga al
//      mensajero»), y al aprobar el cierre se snapshotea en `gestion_orden.ingreso_bodega_rechazo`
//      y en `cierre_dia.total_ingreso_bodega_rechazos` (`CierreDiaRepository`), o sea EN EL CIERRE
//      DEL MENSAJERO al que se atribuye la gestión. Tampoco acaba en su bolsillo:
//      `pagoPorResultado` (`lib/utils/pago-mensajero.ts`) sólo paga `entregada`, y con
//      `cobroEntregado`. En la billetera de la tienda no hay apunte por este concepto.
//   2. A la tienda un rechazo SÍ le cuesta, pero POR OTRA VÍA Y DESDE SU PROPIA TARIFA: el flete de
//      retorno más su IVA — `ingreso_flete_devolucion` + `ingreso_iva_flete_devolucion` en
//      `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`), calculados sobre
//      `Tarifa.valorFleteDevuelto` / `valorFleteDevueltoGam` y el `ivaFlete` de esa misma fila.
//      Ése es el cobro que la tienda ve dos días después.
//
// **Y REPROGRAMAR DESDE AQUÍ NO MUEVE NI UN COLÓN.** `reprogramada` no paga al mensajero (sólo
// `entregada`), no genera ingreso de bodega (sólo `rechazada`) y no factura nada a la tienda: desde
// la ficha 301 `derivarIngresoOrden` emite conceptos únicamente para `entregada` y `rechazada`. Lo
// que sí cuesta en LOS DOS modos es el intento, que adelanta el escalado del cron de plazo vencido.
//
// D7 (firmada) exige decir el precio ANTES, con palabras y siempre visible; sin él la tienda
// descubre el cobro en su billetera dos días después y la primera reclamación es «yo sólo apreté un
// botón». El IMPORTE concreto no se nombra en el aviso visible, por el mismo criterio que la 240
// (`RechazarNovedadModal`, D10): depende de la tarifa vigente de la tienda y de si la orden es GAM.
//
// **UN componente con `modo`, no dos.** La única diferencia entre reprogramar y rechazar es el
// campo de fecha y los rótulos; dos archivos serían dos copias del bloque de evidencias, que es lo
// más largo y lo que no puede divergir.
//
// **Molde: `ReportarIncidenteModal` (feature 158)**, que ya resuelve motivo + 1..N fotos con
// compresión, tope de lista, errores por campo y `FormData` con `append("evidencia", file)` desde
// una pantalla que no es la del mensajero. El selector de fotos es el mismo gesto que
// `GestionarOrdenPanel` (119): previsualización con object URL, quitar por foto y el tope dicho.
//
// **La evidencia es OBLIGATORIA TAMBIÉN AL REPROGRAMAR (D2, firmada por el humano)**, y ésa es la
// única asimetría con el panel del mensajero, que reprograma sin foto. No es rigor gratuito: la
// reprogramación del mensajero ya trae una PRUEBA DE PRESENCIA que la tienda no puede aportar —la
// ubicación es obligatoria en sus cinco ramas desde la 193 y denegar el permiso le bloquea el
// envío—. La tienda gestiona desde un escritorio: la imagen (la captura de la conversación con el
// cliente, típicamente) es su sustituto de esa prueba.
//
// **No se comprueba aquí ningún permiso.** La ventana la monta `NovedadesModule`, que vive dentro
// de una página que el servidor ya acotó a la administración de la tienda dueña; y la Server Action
// vuelve a autorizar por su cuenta (`autorizarSobreHilo` + la ventana de escritura del hilo), que
// es la guardia real. Una guarda de interfaz no protege un dato.

/**
 * Los dos desenlaces, dichos como los dice la pantalla. `modo` es lenguaje de INTERFAZ (el verbo
 * del botón, D7) y `resultado` es el valor del contrato; se traducen en `RESULTADO_POR_MODO`.
 */
export type ModoGestionDesdeAyuda = "reprogramar" | "rechazar";

/**
 * modo → resultado del contrato.
 *
 * ⚠️ Los dos valores NO se escriben a mano aquí: salen de `RESULTADOS_DESDE_AYUDA`, la lista que el
 * borde congela y con la que la Server Action valida. Escribirlos sería una segunda verdad sobre el
 * desenlace, y además esta pantalla tiene una guardia (`novedad-acciones-una-tabla`) que denuncia
 * cualquier literal de estatus escrito en ella, precisamente para que los valores vengan de su
 * declaración única. El orden de la lista queda fijado por el test literal de este modal, escrito a
 * mano: sin él, invertir los dos valores mandaría un rechazo cuando la tienda pulsó reprogramar.
 */
const [RESULTADO_REPROGRAMAR, RESULTADO_RECHAZAR] = RESULTADOS_DESDE_AYUDA;

const RESULTADO_POR_MODO = {
  reprogramar: RESULTADO_REPROGRAMAR,
  rechazar: RESULTADO_RECHAZAR,
} as const satisfies Record<ModoGestionDesdeAyuda, ResultadoDesdeAyuda>;

// --- Textos visibles (separados de la lógica, listos para i18n, como el resto del módulo) --------

/** D7: el título no usa el verbo «gestionar», que la 236/D6 firmó como verbo DEL MENSAJERO. */
export const GESTION_AYUDA_TITULO = "Resolver la orden por tu cuenta";

/**
 * D7 — EL AVISO QUE DICE EL PRECIO. Va arriba, siempre visible y nunca en un tooltip: es lo único
 * que la tienda no puede deducir de la pantalla. Dice las tres consecuencias (el cierre ajeno, el
 * intento y el dinero) y de paso explica por qué se le piden foto y motivo, que es la pregunta que
 * haría cualquiera al ver los campos.
 */
export const GESTION_AYUDA_AVISO_PRECIO =
  "Esto cuenta como una gestión del mensajero: entra en su cierre del día, suma un intento de entrega y mueve el dinero igual. Por eso pide foto y motivo.";

/** D7: los dos rótulos, sin el verbo «gestionar» y sin la palabra «entrega» detrás. */
export const GESTION_AYUDA_CONFIRMAR: Record<ModoGestionDesdeAyuda, string> = {
  reprogramar: "Reprogramar",
  rechazar: "Rechazar",
};

/** D7: la confirmación nombra el desenlace, no dice «Listo». */
export const GESTION_AYUDA_EXITO: Record<ModoGestionDesdeAyuda, string> = {
  reprogramar: "La orden quedó reprogramada.",
  rechazar: "La orden quedó rechazada.",
};

export const GESTION_AYUDA_FECHA_LABEL = "Nueva fecha";
export const GESTION_AYUDA_MOTIVO_LABEL = "Motivo";
export const GESTION_AYUDA_MOTIVO_AYUDA =
  "Lo leerá el mensajero en su cierre del día: contá qué pasó y con quién lo hablaste.";
/** El mismo rótulo del campo de fotos que usa el modal de incidente (158) y el panel (119). */
export const GESTION_AYUDA_EVIDENCIAS_LABEL = "Fotos de evidencia";
/**
 * D2 dicho con palabras en el sitio donde se obedece. La tienda no tiene el paquete delante, así
 * que hay que decirle QUÉ se espera que fotografíe — el mismo criterio con el que la 158 explicó la
 * foto obligatoria de un paquete perdido.
 */
export const GESTION_AYUDA_EVIDENCIAS_AYUDA =
  "La foto es obligatoria también al reprogramar: el mensajero deja constancia de dónde estuvo y vos no podés, así que la imagen es tu respaldo. Sirve la captura de la conversación con el cliente, del mensaje que te escribió o del comprobante que te mandó.";

/** El bloqueo del envío, explicado con TEXTO y no sólo con un botón apagado. */
export const GESTION_AYUDA_FALTA_PREFIJO = "Falta completar:";
export const GESTION_AYUDA_FALTA_MOTIVO = "el motivo";
export const GESTION_AYUDA_FALTA_EVIDENCIA = "al menos una foto";
export const GESTION_AYUDA_FALTA_FECHA = "la nueva fecha";

/**
 * ⚠️ FEATURE 276 (T12, R8/R9) — EN EL TOPE DE INTENTOS ESTA VENTANA NO ABRE EL MODO REPROGRAMAR.
 *
 * Cuando a la orden le queda el último intento (`orden.enElTope`), el servidor ya no acepta una
 * gestión `reprogramada`: reprogramar la devuelve a circulación y es justo lo que el tope cierra.
 * La ventana deja de ofrecer el desenlace en vez de dejar que la tienda lo intente y descubra el
 * límite con un `conflict` —después de haber elegido fecha, escrito el motivo y subido la foto—.
 *
 * R9: se dice CON PALABRAS y no apagando el botón, que diría QUE no se puede pero no POR QUÉ.
 *
 * ⚠️ NO NOMBRA EL NÚMERO (R10): el umbral es configuración del servidor y no cruza al navegador.
 * `tests/components/GestionarDesdeAyudaModalTope.test.tsx` se pone rojo si aparece una cifra aquí.
 *
 * Y NO ES LA DEFENSA (R11): `GestionDesdeAyudaService.gestionar` rechaza igual una petición que
 * pida `reprogramada` en el tope, antes de subir ninguna evidencia.
 */
export const GESTION_AYUDA_TOPE_NOTA =
  "A esta orden le queda el último intento de entrega, así que ya no se puede reprogramar: volver a mandarla a la calle sería un intento de más. Lo que sí podés registrar desde acá es el rechazo, y el mensajero todavía puede entregarla.";

/** El rótulo del único botón que queda cuando el desenlace no está disponible: cerrar y volver. */
export const GESTION_AYUDA_TOPE_CERRAR = "Entendido";

/** Los tres desenlaces que NO son ni `ok` ni `conflict`, dichos de forma accionable. */
export const GESTION_AYUDA_ERROR_FORBIDDEN =
  "No tenés permiso para resolver esta orden.";
export const GESTION_AYUDA_ERROR_SESION = "Tu sesión expiró. Iniciá sesión de nuevo.";

const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");
/** Mismo tope por lista que las otras dos vías: lo impone `evidenciasSchema`, compartido. */
const MAX_EVIDENCIAS = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

export interface GestionarDesdeAyudaModalProps {
  /**
   * Orden en ayuda sobre la que se registra el desenlace (snapshot). El padre monta el modal SOLO
   * con una orden activa y con `key={orden.id}`, así que el formulario arranca fresco en cada
   * apertura sin un efecto de reinicio — mismo patrón que los otros tres modales de la pantalla.
   */
  orden: NovedadDTO;
  modo: ModoGestionDesdeAyuda;
  onOpenChange: (open: boolean) => void;
  /**
   * Desenlace del envío, devuelto TAL CUAL al padre. No se traduce aquí a «éxito/fracaso»: la
   * diferencia entre `ok` y `conflict` es justo la que 236/D8 costó aprender sobre esta misma card
   * («Habilitar» afirmaba haber habilitado aunque la carrera dejara la orden quieta), y quien
   * decide qué se dice y qué se recarga es el módulo que tiene la lista.
   */
  onResuelto: (resultado: DesenlaceGestionDesdeAyuda) => void;
}

/**
 * Los desenlaces que SALEN de esta ventana. `validation_error` no está: lo consume el propio modal
 * pintándolo por campo, con lo capturado intacto. Se excluye del tipo en vez de dejarlo pasar para
 * que el padre no tenga que escribir una rama que nunca se alcanza.
 */
export type DesenlaceGestionDesdeAyuda = Exclude<
  GestionarDesdeAyudaResult,
  { status: "validation_error" }
>;

/** Primer mensaje del campo, si el borde marcó ese campo. */
function firstError(
  errors: Record<string, string[]>,
  campo: string,
): string | undefined {
  return errors[campo]?.[0];
}

export function GestionarDesdeAyudaModal({
  orden,
  modo,
  onOpenChange,
  onResuelto,
}: Readonly<GestionarDesdeAyudaModalProps>) {
  const fechaId = useId();
  const motivoId = useId();
  const evidenciasId = useId();

  const esReprogramar = modo === "reprogramar";

  // R14: la reprogramación más temprana posible es MAÑANA en el calendario de Costa Rica. El valor
  // sale de `fecha-cr` y no de `toISOString()`, que a partir de las 18:00 CR emite el día
  // siguiente; el mismo helper que usa el panel del mensajero, con su off-by-one ya resuelto.
  const [fecha, setFecha] = useState(() => mananaCalendarioCR());
  const [motivo, setMotivo] = useState("");
  const [evidencias, setEvidencias] = useState<File[]>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * Añade las fotos elegidas, comprimidas en el navegador (una foto de celular sin comprimir
   * revienta el límite de body del Server Action con un 413). Concatena sobre lo ya elegido y
   * recorta al tope marcando el error del campo. Calcado de `GestionarOrdenPanel` (119) y de
   * `ReportarIncidenteModal` (158): el gesto de subir evidencias es el mismo en las tres.
   */
  async function handleEvidenciaChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const seleccion = Array.from(input.files ?? []);
    input.value = ""; // permite volver a elegir la MISMA foto tras quitarla
    if (seleccion.length === 0) return;
    setComprimiendo(true);
    try {
      const comprimidas = await Promise.all(seleccion.map((f) => comprimirImagen(f)));
      setEvidencias((prev) => {
        const combinadas = [...prev, ...comprimidas];
        setFieldErrors((errs) => {
          const rest = { ...errs };
          delete rest.evidencias;
          return combinadas.length > MAX_EVIDENCIAS
            ? { ...rest, evidencias: [`Solo podés adjuntar hasta ${MAX_EVIDENCIAS} fotos.`] }
            : rest;
        });
        return combinadas.slice(0, MAX_EVIDENCIAS);
      });
    } finally {
      setComprimiendo(false);
    }
  }

  function quitarEvidencia(index: number) {
    setEvidencias((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((errs) => {
      if (!errs.evidencias) return errs;
      const rest = { ...errs };
      delete rest.evidencias;
      return rest;
    });
  }

  /** Lo que falta para poder enviar, en el orden del formulario. */
  const faltantes: string[] = [];
  if (esReprogramar && fecha.trim() === "") faltantes.push(GESTION_AYUDA_FALTA_FECHA);
  if (motivo.trim() === "") faltantes.push(GESTION_AYUDA_FALTA_MOTIVO);
  // D2: la foto se exige en LOS DOS modos. Una sola condición, sin excepción por modo — si mañana
  // alguien quisiera exceptuar la reprogramación, tendría que reabrir D2, que es lo correcto.
  if (evidencias.length === 0) faltantes.push(GESTION_AYUDA_FALTA_EVIDENCIA);
  const completo = faltantes.length === 0;

  const resultado = RESULTADO_POR_MODO[modo];

  /** El objeto crudo que valida el MISMO schema que revalida el servidor. */
  function buildRaw(): Record<string, unknown> {
    const base = { ordenId: orden.id, motivo, evidencias };
    return esReprogramar
      ? { ...base, resultado, fechaReprogramacion: fecha }
      : { ...base, resultado };
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("ordenId", orden.id);
    fd.set("resultado", resultado);
    fd.set("motivo", motivo.trim());
    if (esReprogramar) fd.set("fechaReprogramacion", fecha);
    // Cada foto va como un valor MÁS de la misma clave `evidencia` (`append`, no `set`); el borde
    // las lee con `getAll("evidencia")` y reconstruye la lista en el ORDEN en que se enviaron.
    // MISMO contrato que el panel del mensajero y que el modal de incidente.
    for (const foto of evidencias) fd.append("evidencia", foto);
    return fd;
  }

  async function handleConfirm() {
    if (comprimiendo) return;
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del botón para no
    // llamar a la acción con el formulario incompleto (patrón `ReportarIncidenteModal`).
    if (!completo) return;

    // R13 en superficie: se valida con el MISMO schema que el borde revalida, así que el cliente no
    // tiene reglas propias que puedan divergir. Aquí es donde se cazan los fallos que el botón no
    // puede ver: el MIME o el tamaño de una foto concreta, y la fecha de hoy o anterior.
    const parsed = gestionarDesdeAyudaSchema.safeParse(buildRaw());
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});

    const res = await gestionarDesdeAyuda(buildFormData());
    if (res.status === "validation_error") {
      // Se pintan por campo y el modal NO se cierra (`closeOnConfirm={false}`): lo capturado
      // —incluidas las fotos, que costaría volver a elegir— sigue ahí.
      setFieldErrors(res.fieldErrors);
      return;
    }
    onResuelto(res);
  }

  const fechaError = firstError(fieldErrors, "fechaReprogramacion");
  const motivoError = firstError(fieldErrors, "motivo");
  const evidenciasError = firstError(fieldErrors, "evidencias");
  const ordenIdError = firstError(fieldErrors, "ordenId");
  // Fallo cerrado del catálogo de estados: el servicio lo devuelve como `validation_error` de un
  // campo que no tiene control en pantalla, así que se pinta suelto en vez de perderse.
  const estatusError = firstError(fieldErrors, "estatus");

  const guia = orden.numGuia !== null ? `guía ${orden.numGuia}` : "sin guía asignada";

  // Feature 276 (T12, R8): el desenlace de este modo, contra la lista de inclusión compartida.
  // `enElTope` llega ya decidido del servidor y su ausencia (fixture viejo; el DTO lo declara
  // opcional por el patrón aditivo) se lee como `false`, el comportamiento de siempre.
  const bloqueadoPorTope = orden.enElTope === true && !permitidoEnElTope(resultado);

  // El modo prohibido NO SE ABRE: sin campo de fecha, sin motivo, sin selector de fotos y sin
  // confirmar. Lo único que se ofrece es el porqué y la salida. Que no haya confirmar es lo que
  // hace imposible llamar a la Server Action desde esta rama.
  if (bloqueadoPorTope) {
    return (
      <Modal
        open
        onOpenChange={onOpenChange}
        title={GESTION_AYUDA_TITULO}
        description={`${orden.destinatario} — ${guia}`}
        hideConfirm
        cancelLabel={GESTION_AYUDA_TOPE_CERRAR}
        size="md"
      >
        <p
          role="note"
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong"
        >
          {GESTION_AYUDA_TOPE_NOTA}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={GESTION_AYUDA_TITULO}
      description={`${orden.destinatario} — ${guia}`}
      confirmLabel={GESTION_AYUDA_CONFIRMAR[modo]}
      // `destructive` sólo al rechazar: reprogramar no cierra ninguna puerta, rechazar cobra.
      confirmVariant={esReprogramar ? "default" : "destructive"}
      confirmDisabled={!completo || comprimiendo}
      onConfirm={handleConfirm}
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {/* D7 — EL PRECIO, ARRIBA Y SIEMPRE VISIBLE. `role="note"` y no `alert`: no es la
            consecuencia de un error, es la condición de la acción, y un `alert` la anunciaría de
            nuevo en cada re-render. */}
        <p
          role="note"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {GESTION_AYUDA_AVISO_PRECIO}
        </p>

        {esReprogramar ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fechaId}>{GESTION_AYUDA_FECHA_LABEL}</Label>
            <Input
              id={fechaId}
              type="date"
              // R14: el `min` lo impide en el selector de fecha del navegador; el schema lo
              // revalida en cliente y el servidor otra vez. El `min` NO es la defensa.
              min={mananaCalendarioCR()}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-invalid={fechaError ? true : undefined}
              aria-label={GESTION_AYUDA_FECHA_LABEL}
            />
            {fechaError ? (
              <p role="alert" className="text-sm text-destructive">
                {fechaError}
              </p>
            ) : null}
          </div>
        ) : null}

        <EvidenciasDesdeAyuda
          inputId={evidenciasId}
          files={evidencias}
          error={evidenciasError}
          onSelect={handleEvidenciaChange}
          onRemove={quitarEvidencia}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={motivoId}>{GESTION_AYUDA_MOTIVO_LABEL}</Label>
          <p id={`${motivoId}-ayuda`} className="text-xs text-muted-foreground">
            {GESTION_AYUDA_MOTIVO_AYUDA}
          </p>
          <textarea
            id={motivoId}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            required
            aria-invalid={motivoError ? true : undefined}
            aria-describedby={`${motivoId}-ayuda`}
            aria-label={GESTION_AYUDA_MOTIVO_LABEL}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {motivoError ? (
            <p role="alert" className="text-sm text-destructive">
              {motivoError}
            </p>
          ) : null}
        </div>

        {ordenIdError ? (
          <p role="alert" className="text-sm text-destructive">
            {ordenIdError}
          </p>
        ) : null}
        {estatusError ? (
          <p role="alert" className="text-sm text-destructive">
            {estatusError}
          </p>
        ) : null}

        {/* El motivo del bloqueo, con palabras. Un botón apagado dice QUE no se puede, no POR QUÉ:
            es la regla que el sub-modal de la 158 y la ventana de la 238 ya siguen. */}
        {completo ? null : (
          <p role="note" className="text-sm text-muted-foreground">
            {`${GESTION_AYUDA_FALTA_PREFIJO} ${faltantes.join(", ")}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Selector de 1..N fotos con los MISMOS límites que las otras dos vías (los impone
 * `evidenciasSchema`, compartido). Vive en este archivo por «sin sobre-ingeniería»
 * (`docs/architecture.md`): un solo consumidor. Es el gemelo del de `ReportarIncidenteModal`, que
 * es el molde de esta ventana.
 */
function EvidenciasDesdeAyuda({
  inputId,
  files,
  error,
  onSelect,
  onRemove,
}: {
  inputId: string;
  files: File[];
  error: string | undefined;
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}) {
  // Una object URL por foto para la previsualización. Se derivan con `useMemo` y el efecto de
  // limpieza REVOCA el lote anterior al cambiar la lista y al desmontar, para no fugar memoria.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{GESTION_AYUDA_EVIDENCIAS_LABEL}</Label>
      <p id={`${inputId}-ayuda`} className="text-xs text-muted-foreground">
        {GESTION_AYUDA_EVIDENCIAS_AYUDA}
      </p>
      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos de evidencia seleccionadas">
          {previews.map((url, i) => (
            <li key={url} className="relative">
              {/* Vista previa local de un object URL: next/image no aplica a un blob. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Evidencia ${i + 1}`}
                className="size-20 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Quitar evidencia ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-background bg-destructive p-0.5 text-destructive-foreground shadow-xs hover:bg-destructive/90"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_MIME}
        multiple
        onChange={onSelect}
        aria-invalid={error ? true : undefined}
        aria-label={GESTION_AYUDA_EVIDENCIAS_LABEL}
        aria-describedby={`${inputId}-ayuda ${inputId}-limite`}
        className="text-sm"
      />
      <p id={`${inputId}-limite`} className="text-xs text-muted-foreground">
        {`Podés adjuntar hasta ${MAX_EVIDENCIAS} fotos (${files.length}/${MAX_EVIDENCIAS}).`}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
