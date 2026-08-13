"use client";

import { useId, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { montoValido } from "@/components/shared/monto-cliente";
import {
  LIQUIDACION_MONTO_MAX,
  LIQUIDACION_NOTA_MAX,
  LIQUIDACION_REFERENCIA_MAX,
  esFechaPagoValida,
} from "@/lib/types/liquidacion";
import type {
  MetodoLiquidacion,
  PagoRegistradoDTO,
  RegistrarPagoResult,
} from "@/lib/types/liquidacion";
import type { RegistrarRepartoResult } from "@/lib/types/liquidacion-reparto";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { nuevaClaveIdempotencia } from "./clave-idempotencia";
import {
  METODO_LIQUIDACION_OPTIONS,
  REGISTRAR_PAGO_ERROR,
  REGISTRAR_PAGO_RESPUESTA,
  REGISTRAR_PAGO_TEXTO,
  money,
} from "./liquidacion-labels";

// Feature 172 (T D.1, design §10) — FORMULARIO de registro de un pago. Compartido: lo montan
// `/wallet/tiendas` (Tanda D) y `/cierres-admin` (Tanda E), y por eso NO sabe a quién se
// paga: recibe `onRegistrar`, y quien lo monta le añade el `tiendaId` o el `cierreId`. Esa
// es también la razón de que viva en `components/shared/` (`docs/architecture.md`: se
// promueve cuando dos features lo necesitan con la misma API).
//
// MONEY-SAFE (R14): CERO `Number(` y CERO `parseFloat` en este archivo. El monto entra como
// STRING, se prefija con el STRING que devolvió el servidor y sale como STRING. Aquí no se
// resta ni se compara contra el disponible: lo que se puede pagar lo decide el SERVIDOR bajo
// candado (R31/R46), y el navegador solo pinta lo que le dicen. La única comparación de
// dinero es la del TOPE DE COLUMNA, y la hace `montoValido` por texto.
//
// LA CLAVE DE IDEMPOTENCIA es la mitad del valor de este componente (§4.1, R43/R47):
//  - se genera AL ABRIRSE el diálogo, no al enviar (si se generara al enviar, dos clics
//    darían dos claves y dos pagos);
//  - se CONSERVA entre reintentos —también si el diálogo se cierra y se vuelve a abrir tras
//    un fallo—, porque un fallo de red puede haber dejado el pago escrito igualmente: con la
//    misma clave, el servidor responde `ya_registrado` en vez de cobrar dos veces;
//  - se RENUEVA solo cuando el pago quedó registrado (`ok` o `ya_registrado`), que es cuando
//    la solicitud siguiente es de verdad otra solicitud (R45).

/** Los campos del pago que este formulario conoce. El beneficiario lo pone quien lo monta. */
export interface RegistrarPagoCampos {
  claveIdempotencia: string;
  monto: string;
  metodo: MetodoLiquidacion;
  referencia?: string;
  nota?: string;
  fechaPago: string;
}

/** La respuesta que deja el pago REGISTRADO, con su comprobante (R47). */
export type PagoRegistradoOk = Extract<
  RegistrarPagoResult,
  { status: "ok" } | { status: "ya_registrado" }
>;

/**
 * Feature 205 (T5.1) — lo que este diálogo admite como respuesta del servidor.
 *
 * Se ensancha de UN tipo a DOS porque el reparto de la 205 responde con `RepartoAplicadoDTO`
 * (N imputaciones) y no con un comprobante: no hay un `pago` que devolver, hay varios. Los dos
 * contratos comparten los MISMOS nombres de estado a propósito (design §7.2 de la 205), así que
 * el `switch` de `avisoDe` sigue siendo exhaustivo y aquí no se estrena vocabulario.
 *
 * **Es aditivo y no cambia nada de lo existente**: quien devuelve un `RegistrarPagoResult` sigue
 * encajando, y `onRegistrado` —que es lo único que mira dentro del resultado— solo se invoca
 * cuando la respuesta TRAE comprobante. Un reparto no lo trae, y su pantalla se entera por el
 * valor que devuelve su propio `onRegistrar`.
 */
export type ResultadoDeRegistro = RegistrarPagoResult | RegistrarRepartoResult;

export interface RegistrarPagoDialogProps {
  /** Visibilidad controlada por el padre (mismo contrato que `Modal`). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre visible del beneficiario: da nombre accesible al diálogo. */
  beneficiario: string;
  /**
   * Lo máximo que se puede pagar hoy, STRING del servidor (saldo de la tienda o pendiente
   * del cierre). Prefija el monto (R23/R30) y se pinta tal cual; no se opera con él.
   */
  disponible: string;
  /** Envía el registro. La devuelve quien monta, que es quien sabe a quién se paga. */
  onRegistrar: (campos: RegistrarPagoCampos) => Promise<ResultadoDeRegistro>;
  /**
   * Se invoca cuando el pago quedó registrado, con el comprobante que devolvió el servidor.
   *
   * Solo se invoca si la respuesta TRAE comprobante: el reparto de la 205 registra N pagos y
   * responde con el reparto aplicado, así que su pantalla se entera por el valor que devuelve
   * su propio `onRegistrar` y no por aquí.
   */
  onRegistrado?: (pago: PagoRegistradoDTO, resultado: PagoRegistradoOk) => void;
  /**
   * Feature 172 (T E.1) — etiqueta del botón que cierra sin pagar. ADITIVA y opcional: por
   * defecto es «Cancelar», que es lo que dice cuando alguien abre el formulario a propósito.
   *
   * Existe porque hay UN caso en el que ese botón no significa «cancelar»: el diálogo que se
   * ofrece justo después de aprobar un cierre (§8). Ahí no hay nada que cancelar —el cierre YA
   * está aprobado y el mensajero, libre— y el botón significa «pagar más tarde». Llamarlo
   * «Cancelar» insinuaría que se está deshaciendo la aprobación, que es justo la lectura que
   * R17/R18 existen para impedir.
   */
  cancelLabel?: string;
  /**
   * Feature 205 (T5.1, R27/R31/R34) — HUECO opcional bajo el campo de monto. Recibe el monto
   * TAL CUAL se está tecleando y devuelve lo que haya que pintar debajo (en la 205, la
   * previsualización del reparto entre cierres).
   *
   * ADITIVA y opcional: sin ella el diálogo se comporta exactamente como hasta hoy. Es un
   * hueco y no una previsualización propia porque **este diálogo no sabe a quién se paga**
   * (esa es la razón de que viva en `shared/`): quien lo monta es quien puede pedirle al
   * servidor qué pasaría con ese monto. Aquí no se calcula nada, ni siquiera se lee el monto.
   *
   * Y no toca la clave de idempotencia (R27/R31): el hueco se pinta DENTRO de la solicitud
   * viva, así que teclear, esperar la previsualización o reintentar tras un fallo siguen
   * siendo la misma solicitud con la misma clave.
   */
  renderPrevisualizacion?: (monto: string) => ReactNode;
  /**
   * Feature 205 (T5.2) — el aviso de `sin_saldo`, por si el beneficiario no es una tienda.
   *
   * El texto por defecto habla de una tienda («Esta tienda no tiene saldo a favor…»), que es
   * lo que este diálogo ha dicho desde la 172. Al pagarle a un MENSAJERO ese aviso sería falso
   * en la única pantalla donde puede aparecer: `sin_saldo` significa ahí que ya no queda ningún
   * cierre aprobado con saldo. Es un rótulo, no una regla: el estado y su semántica no cambian.
   */
  mensajeSinSaldo?: string;
  /** Instante «ahora». Inyectable para poder fijar el día en los tests. */
  ahora?: Date;
}

/**
 * Una SOLICITUD de pago viva: su clave de idempotencia y lo que se ha escrito. Van juntas
 * porque son la misma cosa — reintentar es reenviar ESTA solicitud, no escribir otra.
 */
interface Sesion {
  clave: string;
  monto: string;
  metodo: MetodoLiquidacion;
  referencia: string;
  nota: string;
  fechaPago: string;
}

/** Abre una solicitud nueva: clave recién acuñada y el formulario en su estado de partida. */
function nuevaSesion(disponible: string, hoy: string): Sesion {
  return {
    clave: nuevaClaveIdempotencia(),
    // R23/R30: el monto se propone al máximo que se puede pagar, y se edita a la baja.
    monto: disponible,
    metodo: "efectivo",
    referencia: "",
    nota: "",
    fechaPago: hoy,
  };
}

/** Errores por campo, con las mismas claves que emite el borde del servidor. */
interface ErroresCampo {
  monto?: string;
  metodo?: string;
  referencia?: string;
  nota?: string;
  fechaPago?: string;
}

/**
 * Traduce la respuesta del servidor a un aviso para el usuario. Vive fuera del componente
 * para que el `switch` sea exhaustivo sobre `RegistrarPagoResult`: un estado nuevo en el
 * contrato rompe el build en vez de caer en un `default` mudo.
 */
function avisoDe(resultado: ResultadoDeRegistro, mensajeSinSaldo: string): string {
  switch (resultado.status) {
    case "ok":
      return REGISTRAR_PAGO_RESPUESTA.ok;
    case "ya_registrado":
      return REGISTRAR_PAGO_RESPUESTA.yaRegistrado;
    case "excede":
      return REGISTRAR_PAGO_RESPUESTA.excede(resultado.disponible);
    case "sin_saldo":
      return mensajeSinSaldo;
    case "cierre_no_aprobado":
      return REGISTRAR_PAGO_RESPUESTA.cierreNoAprobado;
    case "no_encontrado":
      return REGISTRAR_PAGO_RESPUESTA.noEncontrado;
    case "forbidden":
      return REGISTRAR_PAGO_RESPUESTA.forbidden;
    case "unauthenticated":
      return REGISTRAR_PAGO_RESPUESTA.unauthenticated;
    case "validation_error":
      // Los mensajes van por campo; el aviso general se deja vacío para no duplicarlos.
      return "";
  }
}

/** Primer mensaje de cada campo del `validation_error` del borde, con sus mismas claves. */
function erroresDelBorde(fieldErrors: Record<string, string[]>): ErroresCampo {
  return {
    monto: fieldErrors.monto?.[0],
    metodo: fieldErrors.metodo?.[0],
    referencia: fieldErrors.referencia?.[0],
    nota: fieldErrors.nota?.[0],
    fechaPago: fieldErrors.fechaPago?.[0],
  };
}

export function RegistrarPagoDialog({
  open,
  onOpenChange,
  beneficiario,
  disponible,
  onRegistrar,
  onRegistrado,
  cancelLabel = REGISTRAR_PAGO_TEXTO.cancelar,
  renderPrevisualizacion,
  mensajeSinSaldo = REGISTRAR_PAGO_RESPUESTA.sinSaldo,
  ahora = new Date(),
}: RegistrarPagoDialogProps) {
  // Hoy en hora de COSTA RICA, no en UTC: entre las 18:00 y la medianoche de CR el día UTC
  // ya es el siguiente y «mañana» pasaría por «hoy» (el mismo off-by-one que blinda el
  // borde del servidor). Es un STRING `YYYY-MM-DD`, así que es estable entre renders.
  const hoy = fechaCalendarioCR(ahora);

  const idBase = useId();
  const campoId = (nombre: string) => `${idBase}-${nombre}`;

  // La SOLICITUD viva. Todo el formulario es un solo estado a propósito: una solicitud de
  // pago es una unidad —su clave y lo que se escribió van juntos— y así «empezar una
  // solicitud nueva» y «conservar la que falló» son una sola asignación cada una, imposible
  // de dejar a medias. `null` = no hay solicitud abierta.
  const [sesion, setSesion] = useState<Sesion | null>(
    open ? () => nuevaSesion(disponible, hoy) : null,
  );
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [aviso, setAviso] = useState<string | null>(null);

  // Transición CERRADO → ABIERTO. Se ajusta el estado durante el render, que es la forma que
  // React documenta para reaccionar a un cambio de prop; con un efecto sería un `setState`
  // en cascada, que en este repo es error de lint (`react-hooks/set-state-in-effect`).
  //
  // La condición es lo que hace de esto la mitad del valor del componente: solo se acuña una
  // solicitud nueva SI NO HAY NINGUNA VIVA. Si la hay, el diálogo se está reabriendo tras un
  // fallo y se conserva entera —clave incluida—, porque esa petición pudo escribirse aunque
  // la respuesta se perdiera y reintentarla con otra clave pagaría dos veces.
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open && sesion === null) {
      setSesion(nuevaSesion(disponible, hoy));
      setErrores({});
      setAviso(null);
    }
  }

  // Sin solicitud viva no hay nada que montar. Solo ocurre con el diálogo cerrado: al
  // abrirse, el ajuste de arriba crea la solicitud antes de que se rendericen los hijos.
  if (sesion === null) return null;

  const { clave, monto, metodo, referencia, nota, fechaPago } = sesion;

  /** Edita un campo de la solicitud viva, sin tocar su clave. */
  function editar<K extends keyof Omit<Sesion, "clave">>(campo: K, valor: Sesion[K]) {
    setSesion((actual) => (actual === null ? actual : { ...actual, [campo]: valor }));
  }

  const referenciaLimpia = referencia.trim();
  const referenciaObligatoria = metodo !== "efectivo";

  // Validación de CLIENTE con el mismo criterio que revalida el borde: formato y tope del
  // monto, referencia obligatoria en pago electrónico, topes de texto y fecha no futura en
  // hora de CR. Lo que NO se comprueba aquí es si el monto cabe en lo disponible: eso es una
  // resta de dinero y se hace en el servidor, bajo candado.
  const montoOk = montoValido(monto, LIQUIDACION_MONTO_MAX);
  const referenciaOk =
    referenciaLimpia.length <= LIQUIDACION_REFERENCIA_MAX &&
    (!referenciaObligatoria || referenciaLimpia.length > 0);
  const notaOk = nota.length <= LIQUIDACION_NOTA_MAX;
  const fechaOk = esFechaPagoValida(fechaPago, ahora);
  const formularioValido = montoOk && referenciaOk && notaOk && fechaOk;

  /** Errores visibles al intentar enviar: se calculan aquí para no gritar mientras se teclea. */
  function erroresLocales(): ErroresCampo {
    return {
      monto: montoOk
        ? undefined
        : montoValido(monto)
          ? REGISTRAR_PAGO_ERROR.montoTope(LIQUIDACION_MONTO_MAX)
          : REGISTRAR_PAGO_ERROR.monto,
      referencia: referenciaOk
        ? undefined
        : referenciaLimpia.length > LIQUIDACION_REFERENCIA_MAX
          ? REGISTRAR_PAGO_ERROR.referenciaLarga(LIQUIDACION_REFERENCIA_MAX)
          : REGISTRAR_PAGO_ERROR.referenciaObligatoria,
      nota: notaOk ? undefined : REGISTRAR_PAGO_ERROR.notaLarga(LIQUIDACION_NOTA_MAX),
      fechaPago: fechaOk ? undefined : REGISTRAR_PAGO_ERROR.fechaPago,
    };
  }

  async function confirmar() {
    if (!formularioValido) {
      setErrores(erroresLocales());
      return;
    }

    setErrores({});
    setAviso(null);

    // Los campos opcionales VACÍOS no se mandan: el schema del borde es `.strict()` y los
    // declara opcionales, así que una cadena vacía sería una referencia en blanco guardada
    // como si alguien la hubiera escrito.
    const campos: RegistrarPagoCampos = {
      claveIdempotencia: clave,
      monto: monto.trim(),
      metodo,
      fechaPago,
      ...(referenciaLimpia ? { referencia: referenciaLimpia } : {}),
      ...(nota.trim() ? { nota: nota.trim() } : {}),
    };

    let resultado: ResultadoDeRegistro;
    try {
      resultado = await onRegistrar(campos);
    } catch {
      // Fallo de RED o del servidor: la clave NO se renueva. Puede que el pago se escribiera
      // igualmente y no lo sepamos; reenviar con la misma clave devolverá `ya_registrado` en
      // vez de crear un segundo pago.
      setAviso(REGISTRAR_PAGO_RESPUESTA.fallo);
      return;
    }

    if (resultado.status === "ok" || resultado.status === "ya_registrado") {
      // Registrado: esta solicitud TERMINÓ, así que se cierra entera. Al volver a abrirse no
      // habrá ninguna viva y se acuñará una clave nueva — que es lo que hace que dos pagos
      // legítimos con el mismo importe, método y día sean DOS pagos (R45) y no uno que
      // desaparece en silencio.
      setSesion(null);
      // Solo hay comprobante que entregar si la respuesta lo trae: el reparto de la 205
      // registra N pagos y devuelve el reparto aplicado, no un comprobante único.
      if ("pago" in resultado) onRegistrado?.(resultado.pago, resultado);
      onOpenChange(false);
      return;
    }

    if (resultado.status === "validation_error") {
      setErrores(erroresDelBorde(resultado.fieldErrors));
      setAviso(null);
      return;
    }

    setAviso(avisoDe(resultado, mensajeSinSaldo));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={REGISTRAR_PAGO_TEXTO.titulo(beneficiario)}
      description={REGISTRAR_PAGO_TEXTO.descripcion}
      confirmLabel={REGISTRAR_PAGO_TEXTO.confirmar}
      cancelLabel={cancelLabel}
      confirmDisabled={!formularioValido}
      onConfirm={confirmar}
      /* El cierre lo decide `confirmar`: un rechazo del servidor deja el diálogo abierto con
         lo que el usuario escribió, y con la MISMA clave. */
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {REGISTRAR_PAGO_TEXTO.disponible}:{" "}
          <span className="font-medium text-foreground">{money(disponible)}</span>
        </p>

        {aviso ? (
          <p role="alert" className="text-sm text-destructive">
            {aviso}
          </p>
        ) : null}

        <FormField
          id={campoId("monto")}
          label={REGISTRAR_PAGO_TEXTO.monto}
          hint={REGISTRAR_PAGO_TEXTO.disponibleAyuda}
          required
          error={errores.monto}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={monto}
              onChange={(e) => {
                editar("monto", e.target.value);
                setErrores((p) => ({ ...p, monto: undefined }));
              }}
              placeholder="0.00"
            />
          )}
        </FormField>

        {/* Feature 205 (T5.1) — el hueco de la previsualización, JUSTO bajo el monto que la
            produce. Recibe el monto tal cual está tecleado; qué hacer con él lo decide quien
            monta el diálogo, que es quien sabe a quién se paga. */}
        {renderPrevisualizacion ? renderPrevisualizacion(monto) : null}

        <FormField
          id={campoId("metodo")}
          label={REGISTRAR_PAGO_TEXTO.metodo}
          required
          error={errores.metodo}
        >
          {/* El `Select` no acepta `aria-required`, así que la accesibilidad se cablea
              campo a campo en vez de por spread (molde: `CrearTiendaForm`). */}
          {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => (
            <Select
              id={id}
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
              aria-label={REGISTRAR_PAGO_TEXTO.metodo}
              value={metodo}
              onValueChange={(v) => {
                editar("metodo", v as MetodoLiquidacion);
                setErrores((p) => ({ ...p, referencia: undefined }));
              }}
              options={METODO_LIQUIDACION_OPTIONS}
            />
          )}
        </FormField>

        <FormField
          id={campoId("referencia")}
          label={REGISTRAR_PAGO_TEXTO.referencia}
          hint={
            referenciaObligatoria
              ? REGISTRAR_PAGO_TEXTO.referenciaAyudaObligatoria
              : REGISTRAR_PAGO_TEXTO.referenciaAyudaOpcional
          }
          required={referenciaObligatoria}
          error={errores.referencia}
        >
          {(control) => (
            <Input
              {...control}
              value={referencia}
              onChange={(e) => {
                editar("referencia", e.target.value);
                setErrores((p) => ({ ...p, referencia: undefined }));
              }}
            />
          )}
        </FormField>

        <FormField
          id={campoId("fechaPago")}
          label={REGISTRAR_PAGO_TEXTO.fechaPago}
          hint={REGISTRAR_PAGO_TEXTO.fechaPagoAyuda}
          required
          error={errores.fechaPago}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              /* Tope del selector nativo; la regla de verdad la impone el borde. */
              max={hoy}
              value={fechaPago}
              onChange={(e) => {
                editar("fechaPago", e.target.value);
                setErrores((p) => ({ ...p, fechaPago: undefined }));
              }}
            />
          )}
        </FormField>

        <FormField
          id={campoId("nota")}
          label={REGISTRAR_PAGO_TEXTO.nota}
          hint={REGISTRAR_PAGO_TEXTO.notaAyuda}
          error={errores.nota}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={nota}
              onChange={(e) => {
                editar("nota", e.target.value);
                setErrores((p) => ({ ...p, nota: undefined }));
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
