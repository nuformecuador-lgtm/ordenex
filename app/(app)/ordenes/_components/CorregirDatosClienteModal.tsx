"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import type { CorregirDatosClienteActionResult } from "@/lib/actions/corregir-datos-cliente";
import {
  corregirDatosClienteSchema,
  type CorregirDatosClienteEntrada,
} from "@/lib/types/correccion-datos-cliente";

import { corregirDatosClienteErrorMessage } from "./corregir-datos-cliente-error-messages";

// =================================================================================================
// FICHA 312 (E1, design §9.3) — LA VENTANA CON LA QUE SE CORRIGEN LOS DATOS DEL CLIENTE.
// =================================================================================================
//
// **Que problema cierra.** La carga masiva entra con el destinatario o el telefono mal escritos y
// hasta hoy la aplicacion no ofrecia NINGUNA superficie para arreglarlo: la unica via era un
// `UPDATE` a mano contra produccion.
//
// **La comparte LAS DOS superficies** (design §9.3): el modulo de ordenes (`maestro`/`admin`, por
// su disparador de fila) y las cards de `/novedades` (`adminTienda`, en los DOS grupos). Vive aqui
// —donde nace y donde esta su consumidor principal— y `/novedades` la IMPORTA, igual que
// `/recepcion-satelite` importa `ReportarIncidenteAccion`.
//
// **CUATRO CAMPOS Y NADA MAS** (D1): `destinatario`, `telefonoDest`, `producto` y `notas`. Fuera
// direccion, ubicacion, zona, monto, estatus y tienda. La direccion se deja fuera A SABIENDAS de
// que es el error de carga mas caro: es alcance cerrado por el humano, no un olvido.
//
// ⚠️ **SIN RASTRO** (D4, decision humana del 2026-08-28). Corregir NO publica nota en el hilo, NO
// escribe historial y NO deja auditoria: el unico rastro es el `updated_at` de la fila. Por eso
// NINGUN texto de esta ventana promete un registro («se guardara quien lo cambio» y similares estan
// prohibidos): no se registra, y una promesa falsa en la pantalla es peor que el silencio. La nota
// automatica esta EVALUADA Y DESCARTADA en `design.md` §8/B.
//
// ⚠️ **NI UN `console` EN ESTE ARCHIVO** (R16), y no es estilo: el destinatario, el telefono, el
// producto y las notas son datos de una persona real. Una guardia lo vigila
// (`tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts`).
//
// **NO OFRECE REIMPRIMIR LA ETIQUETA** (P4, respondida el 2026-08-28): R27 AVISA y nada mas. La
// reimpresion ya existe como gesto propio en la fila del listado (`EtiquetaOrdenAccion`) y esta
// ficha no lo cambia ni lo duplica dentro de la ventana.

/**
 * Forma MINIMA que la ventana necesita de una orden. La cumplen POR ESTRUCTURA tanto
 * `OrdenListItemDTO` (listado de `/ordenes`) como `NovedadDTO` (cards de `/novedades`), asi que las
 * dos superficies comparten un solo cuerpo sin arrastrar ninguno de los dos DTO completos. Mismo
 * patron que `ReportarIncidenteOrdenUI` y `EliminarOrdenUI`.
 */
export interface CorregirDatosClienteOrdenUI {
  id: string;
  numRemision: string;
  numGuia?: number | null;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  notas?: string | null;
  /** El estado decide si la accion se OFRECE (R22/R24). Lo mira el disparador, no esta ventana. */
  estatusValue?: string | null;
}

/**
 * Como se dispara la correccion. **La ventana no importa la Server Action: se la pasa la
 * superficie que la monta**, y las dos pasan LA MISMA (`corregirDatosCliente`).
 *
 * ⚠️ Esto NO es una preferencia de estilo y conviene no «simplificarlo» de vuelta. `/novedades`
 * tiene una guardia propia —`novedad-acciones-sin-maqueta.guardia.test.ts`, nacida de ocho dias de
 * un boton que avisaba por toast sin mutar nada— que exige que **algun archivo de
 * `app/(app)/novedades/` importe Y LLAME** a la operacion que su fila declara en
 * `PRODUCTOR_POR_ACCION`. Con la llamada escondida aqui dentro, en otra carpeta, esa guardia veria
 * un boton sin cable y estaria en lo cierto: el cable se ve en la pantalla que ofrece el boton.
 */
export type EnviarCorreccion = (
  entrada: CorregirDatosClienteEntrada,
) => Promise<CorregirDatosClienteActionResult>;

export interface CorregirDatosClienteModalProps {
  open: boolean;
  /** Orden UNA, nunca un lote: los cuatro campos son propios de cada orden (design §8/F). */
  orden: CorregirDatosClienteOrdenUI;
  onOpenChange: (open: boolean) => void;
  /** El disparo real. Ver `EnviarCorreccion`. */
  corregir: EnviarCorreccion;
  /** Exito: el padre cierra y RELEE el estado DEL SERVIDOR (R29). Nada de optimismo local. */
  onSuccess: () => void;
}

// --- Textos visibles (separados de la logica, i18n-ready, como el resto del modulo) --------------

export const CORREGIR_TITULO = "Corregir los datos del cliente";
export const CORREGIR_CONFIRMAR = "Guardar cambios";

/** D1 dicho en la ventana: lo que NO se corrige aqui, para que nadie lo busque. */
export const CORREGIR_ALCANCE =
  "Solo se corrigen estos cuatro datos. La dirección, la zona y el monto a cobrar no se tocan desde aquí.";

export const CORREGIR_DESTINATARIO_LABEL = "Destinatario";
export const CORREGIR_TELEFONO_LABEL = "Teléfono del destinatario";
export const CORREGIR_PRODUCTO_LABEL = "Producto";
export const CORREGIR_NOTAS_LABEL = "Notas";
export const CORREGIR_NOTAS_AYUDA = "Se puede dejar vacío.";

/**
 * R27 — EL AVISO DE LA ETIQUETA, solo cuando la orden YA tiene guia. El papel pegado al paquete se
 * imprimio con los datos viejos y ninguna correccion lo cambia: quien esta delante de la pantalla
 * tiene que saberlo ANTES de confirmar, no despues.
 *
 * Nombra la guia concreta porque es el dato con el que se busca ese paquete en la bodega.
 */
export function corregirAvisoEtiqueta(numGuia: number): string {
  return `Esta orden ya tiene la guía ${numGuia} impresa: la etiqueta pegada al paquete seguirá mostrando los datos anteriores.`;
}

/**
 * R28 — EL AVISO DE WHATSAPP, solo cuando el telefono cambio respecto del precargado. La
 * conversacion anterior se queda donde esta, intacta (R19): si el numero estaba mal escrito, ese
 * hilo es una conversacion con OTRA persona y no sirve de nada, asi que no se migra ni se fusiona
 * (D5, design §5.3).
 */
export const CORREGIR_AVISO_WHATSAPP =
  "Los mensajes nuevos irán al número corregido. La conversación anterior se conserva, pero no se traslada.";

/** R6/R30 — el bloqueo, con PALABRAS. Un botón apagado dice QUE no se puede, no POR QUÉ. */
export const CORREGIR_FALTAN_CAMPOS_PREFIJO = "Falta completar:";
export const CORREGIR_FALTA_DESTINATARIO = "el destinatario";
export const CORREGIR_FALTA_TELEFONO = "el teléfono";
export const CORREGIR_FALTA_PRODUCTO = "el producto";

export const CORREGIR_EXITO = "Datos corregidos.";
/** R4 — el servidor no escribió nada porque no había nada que cambiar. No es un error. */
export const CORREGIR_SIN_CAMBIOS = "No había nada que cambiar: los datos ya eran esos.";

/** Primer mensaje del campo, si el borde marcó ese campo. */
function primerError(
  errores: Record<string, string[]>,
  campo: string,
): string | undefined {
  return errores[campo]?.[0];
}

/**
 * Ventana de correccion de los datos del cliente de UNA orden.
 *
 * - **Cuatro campos precargados** con los valores actuales (R26).
 * - **Valida en cliente con EL MISMO** `corregirDatosClienteSchema` que el servidor revalida en el
 *   borde: el cliente no tiene reglas propias que puedan divergir. En particular **no impone un
 *   largo maximo propio** a `producto` ni a `notas` (R6): un tope que la carga masiva no tiene
 *   produciria el caso absurdo «se pudo cargar pero no se puede corregir».
 * - **El servidor sigue siendo la guardia real** (R25): revalida rol, pertenencia y estado en CADA
 *   peticion, con independencia de lo que esta ventana haya ofrecido.
 * - **Ante un rechazo, el borrador NO se limpia** (R30): lo tecleado sigue ahi y el motivo se pinta
 *   dentro de la ventana, que es donde esta la decision.
 */
export function CorregirDatosClienteModal({
  open,
  orden,
  onOpenChange,
  corregir,
  onSuccess,
}: Readonly<CorregirDatosClienteModalProps>) {
  const toast = useToast();
  const destinatarioId = useId();
  const telefonoId = useId();
  const productoId = useId();
  const notasId = useId();

  // R26 — LOS CUATRO CAMPOS PRECARGADOS con los valores actuales de ESTA orden.
  const [destinatario, setDestinatario] = useState(orden.destinatario);
  const [telefono, setTelefono] = useState(orden.telefonoDest);
  const [producto, setProducto] = useState(orden.producto);
  const [notas, setNotas] = useState(orden.notas ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [motivoRechazo, setMotivoRechazo] = useState<string | undefined>(undefined);

  // Cada apertura arranca del dato de la orden, no del borrador de la anterior. Patron «ajustar
  // estado durante el render» (el de `ReportarIncidenteModal`): en un efecto, este `setState`
  // encadenaria un render extra con los valores viejos ya visibles.
  //
  // ⚠️ Se reinicia SOLO al ABRIR. Un rechazo del servidor deja la ventana abierta y el borrador
  // intacto, que es literalmente R30.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setDestinatario(orden.destinatario);
      setTelefono(orden.telefonoDest);
      setProducto(orden.producto);
      setNotas(orden.notas ?? "");
      setFieldErrors({});
      setMotivoRechazo(undefined);
    }
  }

  // Lo que falta para poder enviar, en el orden del formulario. `trim()` porque una linea de
  // espacios no es un destinatario, y porque es lo mismo que hace el servidor antes de comparar:
  // dos reglas distintas sobre el mismo campo dejarian un boton encendido que la accion rechaza.
  //
  // `notas` NO entra: vaciarlo es una correccion valida («notas vacia es ausencia», y el servidor
  // guarda `null`).
  const faltantes: string[] = [];
  if (destinatario.trim() === "") faltantes.push(CORREGIR_FALTA_DESTINATARIO);
  if (telefono.trim() === "") faltantes.push(CORREGIR_FALTA_TELEFONO);
  if (producto.trim() === "") faltantes.push(CORREGIR_FALTA_PRODUCTO);
  const completo = faltantes.length === 0;

  // R28 — ¿el telefono cambio respecto del precargado? Se compara recortado, con el mismo criterio
  // con el que el servidor decide si hay cambio (R4): asi el aviso no aparece por un espacio.
  const telefonoTocado = telefono.trim() !== orden.telefonoDest.trim();

  // R27 — la orden ya tiene papel impreso. `undefined`/`null` = sin guia = sin aviso.
  const guiaImpresa = orden.numGuia ?? null;

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del bloqueo visual para
    // no llamar a la accion con un campo vacio (patron `ReportarIncidenteModal`).
    if (!completo) return;

    // Validacion de borde en cliente con EL MISMO schema del servidor (R6: sin tope propio).
    const parsed = corregirDatosClienteSchema.safeParse({
      ordenId: orden.id,
      destinatario,
      telefonoDest: telefono,
      producto,
      // "" es «vaciar las notas»: el servidor lo normaliza a `null`, igual que la carga masiva.
      notas,
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});
    setMotivoRechazo(undefined);

    // Se envian los cuatro campos y el SERVIDOR hace el diff (R4): la pantalla no decide que
    // cambio, porque su idea de «igual» y la del servidor —que compara tras recortar— podrian no
    // coincidir. `cambios: []` es un desenlace legitimo, no un error.
    const resultado = await corregir(parsed.data);

    if (resultado.status === "ok") {
      toast.success(resultado.cambios.length === 0 ? CORREGIR_SIN_CAMBIOS : CORREGIR_EXITO);
      // R29 — el padre cierra y RELEE del servidor. Esta ventana no pinta nada optimista.
      onSuccess();
      return;
    }

    if (resultado.status === "validation_error") {
      // Se pinta junto a cada campo y la ventana NO se cierra: lo tecleado sigue ahi (R30).
      setFieldErrors(resultado.fieldErrors);
      return;
    }

    // R30 — motivo accionable, DENTRO de la ventana (junto al borrador que se conserva) y sin
    // exponer ningun identificador ni el detalle del rechazo opaco.
    setMotivoRechazo(corregirDatosClienteErrorMessage(resultado));
  }

  const destinatarioError = primerError(fieldErrors, "destinatario");
  const telefonoError = primerError(fieldErrors, "telefonoDest");
  const productoError = primerError(fieldErrors, "producto");
  const notasError = primerError(fieldErrors, "notas");
  const ordenIdError = primerError(fieldErrors, "ordenId");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={CORREGIR_TITULO}
      description={`Orden ${orden.numRemision}`}
      confirmLabel={CORREGIR_CONFIRMAR}
      confirmDisabled={!completo}
      onConfirm={handleConfirm}
      // No se cierra al confirmar: lo hace el padre cuando el servidor dijo `ok` (R29/R30).
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p role="note" className="text-sm text-muted-foreground">
          {CORREGIR_ALCANCE}
        </p>

        {/* R27 — el papel ya impreso. Va ARRIBA y siempre visible: es una condicion de la accion,
            no la consecuencia de un error, asi que `role="note"` y no `alert`. Y NO lleva boton de
            reimprimir (P4): esa accion ya vive en la fila del listado. */}
        {guiaImpresa !== null ? (
          <p
            role="note"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          >
            {corregirAvisoEtiqueta(guiaImpresa)}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={destinatarioId}>{CORREGIR_DESTINATARIO_LABEL}</Label>
          <Input
            id={destinatarioId}
            value={destinatario}
            onChange={(event) => setDestinatario(event.target.value)}
            required
            aria-invalid={destinatarioError ? true : undefined}
          />
          {destinatarioError ? (
            <p role="alert" className="text-sm text-destructive">
              {destinatarioError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={telefonoId}>{CORREGIR_TELEFONO_LABEL}</Label>
          <Input
            id={telefonoId}
            type="tel"
            value={telefono}
            onChange={(event) => setTelefono(event.target.value)}
            required
            aria-invalid={telefonoError ? true : undefined}
          />
          {telefonoError ? (
            <p role="alert" className="text-sm text-destructive">
              {telefonoError}
            </p>
          ) : null}
          {/* R28 — solo cuando el numero cambio de verdad. */}
          {telefonoTocado ? (
            <p role="note" className="text-sm text-muted-foreground">
              {CORREGIR_AVISO_WHATSAPP}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={productoId}>{CORREGIR_PRODUCTO_LABEL}</Label>
          {/* R6 — SIN `maxLength`. La carga masiva no tiene tope para este campo y la correccion
              tampoco: un tope propio aqui produciria el caso «se pudo cargar pero no se puede
              corregir» que P3 descarto. */}
          <Input
            id={productoId}
            value={producto}
            onChange={(event) => setProducto(event.target.value)}
            required
            aria-invalid={productoError ? true : undefined}
          />
          {productoError ? (
            <p role="alert" className="text-sm text-destructive">
              {productoError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={notasId}>{CORREGIR_NOTAS_LABEL}</Label>
          <p id={`${notasId}-ayuda`} className="text-xs text-muted-foreground">
            {CORREGIR_NOTAS_AYUDA}
          </p>
          {/* R6 — sin `maxLength`, por el mismo motivo que `producto`. */}
          <Textarea
            id={notasId}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            rows={3}
            aria-describedby={`${notasId}-ayuda`}
            aria-invalid={notasError ? true : undefined}
          />
          {notasError ? (
            <p role="alert" className="text-sm text-destructive">
              {notasError}
            </p>
          ) : null}
        </div>

        {ordenIdError ? (
          <p role="alert" className="text-sm text-destructive">
            {ordenIdError}
          </p>
        ) : null}

        {/* R30 — el rechazo del servidor, junto al borrador que se conserva. */}
        {motivoRechazo ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {motivoRechazo}
          </p>
        ) : null}

        {completo ? null : (
          <p role="note" className="text-sm text-muted-foreground">
            {`${CORREGIR_FALTAN_CAMPOS_PREFIJO} ${faltantes.join(", ")}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
