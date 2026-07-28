"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { PackageCheck, RotateCcw, Undo2, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { NotaPrivadaMensajero } from "./NotaPrivadaMensajero";
import {
  ChatWhatsappPanel,
  BORRADOR_CHAT_VACIO,
  type BorradorChat,
} from "./ChatWhatsappPanel";
import { EnviarPlantillaWhatsappButton } from "./EnviarPlantillaWhatsappButton";
import { CAUSA_DEVOLUCION_OPTIONS } from "./causa-devolucion-options";
import { METODO_PAGO_OPTIONS } from "./metodo-pago-options";
import { VerificarGuiaGate } from "./VerificarGuiaGate";

// Feature 36 / rediseño 63 (pedido humano): detalle GRANDE y centrado de UNA
// orden en reparto con gestión multi-paso, ahora como PANEL INLINE (no modal /
// overlay). Se renderiza en la página, debajo de la grilla de cards. Flujo:
// (1) detalle + botón "Gestionar pedido" (fija el puntero 1-a-1 vía
// `onGestionarPedido`); (2) 4 botones de resultado; (3) campos CONDICIONALES por
// resultado. Valida en cliente con el MISMO schema que revalida el servidor
// (gestionarSchema, R24) y envía FormData a la Server Action `gestionar`. El
// resultado de dominio se refleja como errores por campo (validation_error) o
// Toast (conflict/forbidden). El contrato de backend NO cambia.
//
// Como ya NO hay modal que cerrar, cuando el puntero está fijado (pasos
// resultados/formulario) se ofrece "Cancelar gestión", que libera el puntero
// (vía `onCancelarGestion` del padre) y vuelve al paso "detalle" sin cambiar de
// orden. El reset del estado interno lo garantiza el padre remontando el panel
// con `key={orden.id}` al cambiar de orden.

type Resultado = "entregada" | "reprogramada" | "devuelta" | "rechazada";

/** Pasos del flujo de gestión dentro del panel. */
type Paso = "detalle" | "resultados" | "formulario";

const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");

// Feature 119 (R16): tope de fotos por gestion. El schema (cliente y servidor) usa el
// mismo `gestionConfig.MAX_EVIDENCIAS_POR_GESTION`; en el navegador la env no es visible
// (no lleva `NEXT_PUBLIC_`), asi que cae al default 3, igual que el schema en cliente.
const MAX_EVIDENCIAS = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

/** Configuración visual de los 4 botones de resultado (jerarquía + color). */
const RESULTADO_BOTONES: {
  value: Resultado;
  label: string;
  Icon: typeof PackageCheck;
  className: string;
}[] = [
  {
    value: "entregada",
    label: "Entregar",
    Icon: PackageCheck,
    className:
      "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  },
  {
    value: "rechazada",
    label: "Rechazar",
    Icon: XCircle,
    className:
      "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
  },
  {
    value: "reprogramada",
    label: "Reprogramar",
    Icon: RotateCcw,
    className:
      "border-warning/40 bg-warning/10 text-warning-strong hover:bg-warning/20",
  },
  {
    value: "devuelta",
    label: "Devolver",
    Icon: Undo2,
    className: "border-border bg-muted/40 text-foreground hover:bg-muted",
  },
];

export interface GestionarOrdenPanelProps {
  /** Orden a mostrar/gestionar (la del panel de detalle). */
  orden: MiAsignacionDTO;
  /**
   * `true` si el puntero 1-a-1 ya está fijado en esta orden (gestión en curso):
   * el panel arranca directo en los 4 botones, saltando "Gestionar pedido".
   */
  yaActiva: boolean;
  /**
   * Fija el puntero 1-a-1 (escogerParaGestion) al pulsar "Gestionar pedido".
   * Devuelve `true` si quedó fijado (avanza a los 4 botones); `false` si hubo
   * conflicto/forbidden (el padre ya mostró el Toast; el paso no avanza).
   */
  onGestionarPedido: () => Promise<boolean>;
  /**
   * Libera el puntero 1-a-1 (liberarGestion) al pulsar "Cancelar gestión". Se
   * invoca solo cuando el puntero está fijado (pasos resultados/formulario).
   */
  onCancelarGestion: () => void | Promise<void>;
  /** Se invoca tras un "ok" para que el padre refresque el listado. */
  onSuccess: () => void;
  count: number;
}

/** Primer mensaje de error de un campo (o undefined). */
function firstError(
  errors: Record<string, string[]>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

/**
 * Default y mínimo del campo "Nueva fecha": MAÑANA en el calendario de Costa Rica.
 * Se delega en `fecha-cr` (UTC-6 fijo, la misma convención que usa el backend para
 * `fecha_reprogramacion`): calcularlo con `toISOString()` daba el día siguiente a
 * partir de las 18:00 CR, porque emite la fecha en UTC.
 */
function mananaISO(): string {
  return mananaCalendarioCR();
}

export function GestionarOrdenPanel({
  orden,
  yaActiva,
  onGestionarPedido,
  onCancelarGestion,
  onSuccess,
  count,
}: Readonly<GestionarOrdenPanelProps>) {
  const toast = useToast();

  // El padre remonta este panel (`key={orden.id}`) al cambiar de orden, por lo
  // que el estado interno arranca limpio: si la orden ya está activa, directo en
  // los 4 botones; si no, en el detalle.
  const [paso, setPaso] = useState<Paso>(yaActiva ? "resultados" : "detalle");
  const [resultado, setResultado] = useState<Resultado>("entregada");
  const [metodoPago, setMetodoPago] = useState("");
  const [fechaReprogramacion, setFechaReprogramacion] = useState(mananaISO());
  const [motivo, setMotivo] = useState("");
  // Feature 73 (R4): causa TIPIFICADA de la rama `devuelta`. `""` = sin elegir; el mensajero
  // DEBE escoger una (R6). Es un campo APARTE del `motivo`, que sigue obligatorio (R7).
  const [causaDevolucion, setCausaDevolucion] = useState<CausaDevolucion | "">("");
  // Feature 119 (R14): la evidencia UNICA pasa a una LISTA de 1..N fotos (tope MAX_EVIDENCIAS).
  const [evidencias, setEvidencias] = useState<File[]>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  // Feature 120: borrador COMPARTIDO entre la burbuja de plantillas (junto al teléfono) y el
  // panel de chat. Al elegir una plantilla desde la burbuja, su texto renderizado se "pega" en
  // el input del chat, listo para editar/enviar. Se remonta limpio al cambiar de orden (`key`).
  const [borradorChat, setBorradorChat] = useState<BorradorChat>(BORRADOR_CHAT_VACIO);

  // Feature 119 (R14/R16): agrega las fotos SELECCIONADAS a la lista. Cada foto se comprime
  // en el cliente antes de guardarla (una foto de celular sin comprimir revienta el limite de
  // body del Server Action, 413); `comprimirImagen` cae al archivo original ante cualquier
  // fallo, asi que nunca bloquea la gestion. Mientras comprime, "Guardar gestion" se deshabilita.
  // La seleccion se CONCATENA a lo ya elegido (permite ir sumando en varias tandas). Si el
  // total supera el tope, se RECORTA a MAX_EVIDENCIAS y se marca el error del campo (R16).
  async function handleEvidenciaChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const seleccion = Array.from(input.files ?? []);
    // Limpia el valor del input para permitir volver a elegir la MISMA foto tras quitarla.
    input.value = "";
    if (seleccion.length === 0) return;
    setComprimiendo(true);
    try {
      const comprimidas = await Promise.all(seleccion.map((f) => comprimirImagen(f)));
      // Updater funcional: concatena sobre el estado MAS reciente (a prueba de tandas
      // solapadas). El error de tope se deriva del MISMO `prev` para que array y error nunca
      // se contradigan; setear el error aqui es idempotente (mismo mensaje ante re-invocacion).
      setEvidencias((prev) => {
        const combinadas = [...prev, ...comprimidas];
        setFieldErrors((errs) => {
          const rest = { ...errs };
          delete rest.evidencias;
          return combinadas.length > MAX_EVIDENCIAS
            ? {
                ...rest,
                evidencias: [`Solo puedes adjuntar hasta ${MAX_EVIDENCIAS} fotos.`],
              }
            : rest;
        });
        return combinadas.slice(0, MAX_EVIDENCIAS);
      });
    } finally {
      setComprimiendo(false);
    }
  }

  /** Quita la foto en `index` de la lista (R15) y limpia el error de evidencia. */
  function quitarEvidencia(index: number) {
    setEvidencias((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((errs) => {
      if (!errs.evidencias) return errs;
      const rest = { ...errs };
      delete rest.evidencias;
      return rest;
    });
  }

  // Orden SIN cobro (montoCobrar 0 o null): no hay COD que recaudar, así que el
  // método de pago no aplica. Se oculta el selector y la entrega se envía con
  // recaudo 0 y método "efectivo" (valor neutro para el enum del backend).
  const sinCobro = !orden.montoCobrar;
  const metodoPagoEfectivo = sinCobro ? "efectivo" : metodoPago;

  /** Construye el objeto crudo para validar en cliente con gestionarSchema. */
  function buildRaw(): Record<string, unknown> {
    const base = { ordenId: orden.id, resultado };
    switch (resultado) {
      case "entregada":
        // Feature 119 (R5/R6): la evidencia es una LISTA; una lista vacía dispara `min(1)`.
        return {
          ...base,
          montoRecibido: orden.montoCobrar ?? 0,
          metodoPago: metodoPagoEfectivo || undefined,
          evidencias,
        };
      case "reprogramada":
        return { ...base, fechaReprogramacion, motivo };
      case "devuelta":
        // Feature 73/R6: `|| undefined` reproduce el patrón de `metodoPago` (:159) para que zod
        // diga "requerido" y no "valor inválido" cuando no se eligió ninguna causa.
        // Feature 75/119: la evidencia (lista de fotos) es OBLIGATORIA en `devuelta`, igual que
        // en `rechazada`.
        return {
          ...base,
          causaDevolucion: causaDevolucion || undefined,
          motivo,
          evidencias,
        };
      case "rechazada":
        return { ...base, motivo, evidencias };
    }
  }

  /**
   * Empaqueta los campos + Files en FormData para la Server Action. Feature 119: cada foto va
   * como un valor MÁS de la misma clave `evidencia` (`append`, no `set`); el borde las lee con
   * `getAll("evidencia")` y las reconstruye como lista en el ORDEN en que se enviaron (índice 0..N).
   */
  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("ordenId", orden.id);
    fd.set("resultado", resultado);
    const anexarEvidencias = () => {
      for (const foto of evidencias) fd.append("evidencia", foto);
    };
    if (resultado === "entregada") {
      fd.set("montoRecibido", String(orden.montoCobrar ?? 0));
      fd.set("metodoPago", metodoPagoEfectivo);
      anexarEvidencias();
    } else if (resultado === "reprogramada") {
      fd.set("fechaReprogramacion", fechaReprogramacion);
      fd.set("motivo", motivo);
    } else if (resultado === "devuelta") {
      fd.set("causaDevolucion", causaDevolucion); // feature 73 (R9)
      fd.set("motivo", motivo);
      anexarEvidencias(); // feature 75/119: evidencia obligatoria
    } else {
      fd.set("motivo", motivo);
      anexarEvidencias();
    }
    return fd;
  }

  /** Paso 1: fija el puntero 1-a-1 y, si ok, revela los 4 botones. */
  async function handleGestionarPedido() {
    const ok = await onGestionarPedido();
    if (ok) setPaso("resultados");
  }

  /** Cancela la gestión en curso: libera el puntero y vuelve al detalle. */
  async function handleCancelarGestion() {
    if (cancelando) return;
    setCancelando(true);
    setPaso("detalle");
    setFieldErrors({});
    try {
      await onCancelarGestion();
    } finally {
      setCancelando(false);
    }
  }

  /** Paso 2: elige un resultado y muestra sus campos condicionales. */
  function elegirResultado(next: Resultado) {
    setResultado(next);
    setFieldErrors({});
    setMetodoPago("");
    setFechaReprogramacion(mananaISO());
    setMotivo("");
    setCausaDevolucion(""); // feature 73/R4: cambiar de resultado no arrastra la causa anterior
    setEvidencias([]); // feature 119: cambiar de resultado limpia las fotos elegidas
    setPaso("formulario");
  }

  async function handleConfirm() {
    if (enviando || comprimiendo) return;
    // R22/R24/R25/R27/R29: validación de borde en cliente (mismo schema que el
    // servidor revalida). Errores → por campo, sin enviar.
    const parsed = gestionarSchema.safeParse(buildRaw());
    if (!parsed.success) {
      setFieldErrors(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
      return;
    }
    setFieldErrors({});

    setEnviando(true);
    try {
      const result = await gestionar(buildFormData());
      if (result.status === "ok") {
        toast.success(
          `Orden ${orden.numRemision}: ${estatusLabel(result.estado)}.`,
        );
        onSuccess();
        return;
      }
      if (result.status === "validation_error") {
        // R22/R24 (p. ej. monto != montoCobrar): el servidor devuelve los campos.
        setFieldErrors(result.fieldErrors);
        return;
      }
      // R18/R21 (conflict) / R12 (forbidden) / unauthenticated: Toast de dominio.
      toast.error(
        result.status === "conflict"
          ? "La orden ya no puede gestionarse (estado cambiado o hay otra activa)."
          : "No tienes permiso para gestionar esta orden.",
      );
    } finally {
      setEnviando(false);
    }
  }

  const metodoError = firstError(fieldErrors, "metodoPago");
  // Feature 119: la evidencia es una LISTA -> tanto el cliente (`safeParse`) como el servidor
  // cuelgan sus errores del campo `evidencias`.
  const evidenciaError = firstError(fieldErrors, "evidencias");
  const fechaError = firstError(fieldErrors, "fechaReprogramacion");
  const motivoError = firstError(fieldErrors, "motivo");
  const causaError = firstError(fieldErrors, "causaDevolucion");

  const resultadoLabel =
    RESULTADO_BOTONES.find((b) => b.value === resultado)?.label ?? "";

  return (
    <section
      aria-label="Detalle de la orden"
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-x-hidden rounded-xl border border-border bg-card p-6 shadow-xs"
    >
      <div className="flex flex-row items-center gap-1.5">
        {orden.secuenciaRuta && <h2 className="m-1 text-lg font-semibold bg-brand-light w-6 h-6 flex items-center justify-center rounded pt-1 pb-1 px-1">{orden.secuenciaRuta}</h2>}
        <div>
        <p className="text-xs text-muted-foreground">{orden.numGuia}</p>
        <p className="text-xs text-muted-foreground">
          {orden.secuenciaRuta} de {count}
        </p>
        </div>
      </div>

      {/* Detalle completo: nombre, teléfono, dirección, notas, producto (+ más). */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <AsignacionDetalle orden={orden} />
      </div>

      {/* Feature 116 (R7/R11/R14): editor de la NOTA PRIVADA del mensajero, HERMANO de
          `AsignacionDetalle` (que sigue como presentación pura). Queda claramente separado de la
          "Notas" de la tienda (dentro del detalle) y acompaña a la orden activa también en modo
          foco. `notaPrivada` viaja en el DTO filtrada por el actor; el panel se remonta con
          `key={orden.id}` al cambiar de orden, así que el editor arranca con la nota correcta. */}
      <NotaPrivadaMensajero
        ordenId={orden.id}
        notaInicial={orden.notaPrivada ?? null}
      />

      {/* Paso 1: llamar, whatsapp y verificar la guía antes de gestionar. */}
      {paso === "detalle" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Feature 87 (R17): boton "Llamar". El WhatsApp wa.me plano se reemplaza (pedido
                humano) por el boton de plantilla->wa.me de abajo, que abre WhatsApp con el texto
                de la plantilla elegida. */}
            <ContactoButtons
              telefono={orden.telefonoDest}
              nombre={orden.destinatario}
              size="lg"
              mostrarWhatsapp={false}
            />
            {/* Pedido humano (Option 1): el "globo" ahora elige una plantilla y REDIRIGE FUERA
                abriendo WhatsApp (wa.me) con el texto renderizado. Sin `onElegirPlantilla` usa
                ese flujo wa.me. Funciona con plantillas `pending` (no valida estado activo). */}
            <EnviarPlantillaWhatsappButton orden={orden} size="lg" />
            {/* Feature 120: burbuja que, al elegir una plantilla, PEGA el mensaje en el input del
                chat (borrador compartido) listo para enviar EN LA APP. */}
            <EnviarPlantillaWhatsappButton
              orden={orden}
              size="lg"
              onElegirPlantilla={(p) =>
                setBorradorChat({ texto: p.textoRenderizado, plantillaId: p.id })
              }
            />
          </div>
          {/* Feature 109 (G4/R22-R24) + 120: chat 1:1 con el cliente vía WhatsApp. Cuelga del
              paso "detalle"; el propio panel impone la ventana de 24 h y refresca solo. El
              composer está controlado por el borrador compartido con la burbuja. */}
          <ChatWhatsappPanel
            orden={orden}
            borrador={borradorChat}
            onBorradorChange={setBorradorChat}
          />
          {/* Feature 98: gate de verificación. Antes de fijar el puntero y avanzar
              a los 4 botones, el mensajero DEBE confirmar la guía del paquete
              (escaneo o tecleo) y esta debe COINCIDIR con `orden.numGuia`. Solo
              entonces se dispara `handleGestionarPedido` (escogerParaGestion). */}
          <VerificarGuiaGate
            numGuiaEsperado={orden.numGuia}
            onVerificado={handleGestionarPedido}
          />
        </div>
      ) : null}

      {/* Paso 2: 4 botones GRANDES de resultado (entrada suave). */}
      {paso === "resultados" ? (
        <div className="flex flex-col gap-3 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm font-medium text-muted-foreground">
            ¿Cómo terminó la gestión?
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RESULTADO_BOTONES.map(({ value, label, Icon, className }) => (
              <Button
                key={value}
                type="button"
                onClick={() => elegirResultado(value)}
                className={`h-16 w-full flex-col gap-1 text-base font-semibold ${className}`}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancelarGestion}
            disabled={cancelando}
            className="w-full"
          >
            Cancelar gestión
          </Button>
        </div>
      ) : null}

      {/* Paso 3: campos condicionales del resultado elegido. */}
      {paso === "formulario" ? (
        <div className="flex flex-col gap-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{resultadoLabel}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFieldErrors({});
                setPaso("resultados");
              }}
            >
              Atrás
            </Button>
          </div>

          {resultado === "entregada" ? (
            <>
              {/* Sin cobro (montoCobrar 0/null): no se pide método de pago; la
                  entrega se registra con recaudo 0 y método "efectivo". */}
              {sinCobro ? null : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gestion-metodo">Método de pago</Label>
                  <Select
                    value={metodoPago}
                    onValueChange={setMetodoPago}
                    options={METODO_PAGO_OPTIONS}
                    placeholder="Selecciona un método"
                    aria-label="Método de pago"
                  />
                  {metodoError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {metodoError}
                    </p>
                  ) : null}
                </div>
              )}
              <EvidenciasField
                inputId="gestion-evidencia"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia de entrega"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
            </>
          ) : null}

          {resultado === "reprogramada" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gestion-fecha">Nueva fecha</Label>
                <Input
                  id="gestion-fecha"
                  type="date"
                  // R25: la reprogramación más temprana posible es mañana. El
                  // `min` lo impide en el date picker; `gestionarSchema` lo
                  // revalida en cliente y el servidor otra vez (no es la defensa).
                  min={mananaISO()}
                  value={fechaReprogramacion}
                  onChange={(e) => setFechaReprogramacion(e.target.value)}
                  aria-invalid={fechaError ? true : undefined}
                  aria-label="Nueva fecha de reprogramación"
                />
                {fechaError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fechaError}
                  </p>
                ) : null}
              </div>
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          {resultado === "devuelta" ? (
            <>
              <CausaField
                value={causaDevolucion}
                onChange={setCausaDevolucion}
                error={causaError}
              />
              {/* Feature 75/119: evidencia OBLIGATORIA (lista), espejo de la rama `rechazada`. */}
              <EvidenciasField
                inputId="gestion-evidencia-devolucion"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia de la devolución"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          {resultado === "rechazada" ? (
            <>
              <EvidenciasField
                inputId="gestion-evidencia-rechazo"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia del rechazo"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelarGestion}
              disabled={cancelando || enviando}
            >
              Cancelar gestión
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              loading={enviando}
              disabled={comprimiendo}
            >
              {comprimiendo ? "Procesando foto…" : "Guardar gestión"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Feature 73 (R3/R4): selector de la causa TIPIFICADA, sólo en la rama `devuelta`. Radios
 * (decisión F1.4-f): las 3 opciones visibles de una, móvil-first, sin dropdown que abrir en la
 * calle. Las etiquetas salen SIEMPRE de `CAUSA_DEVOLUCION_OPTIONS` (derivadas del SEED) → aquí
 * no se duplica ninguna cadena ni se pinta el slug crudo del enum. Vive en este archivo, como
 * `MotivoField`: un solo consumidor (docs/architecture.md "sin sobre-ingeniería").
 */
function CausaField({
  value,
  onChange,
  error,
}: {
  value: CausaDevolucion | "";
  onChange: (value: CausaDevolucion | "") => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Título visible del grupo; el nombre accesible del `radiogroup` lo da su `aria-label`
          (mismo contrato que el `Select` de "Método de pago", :372-379). */}
      <Label>Causa de la devolución</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as CausaDevolucion | "")}
        options={CAUSA_DEVOLUCION_OPTIONS}
        aria-label="Causa de la devolución"
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Feature 119 (R14/R15/R16): campo de evidencias MÚLTIPLES, reusado en las 3 ramas con foto
 * (entregada/devuelta/rechazada). Vive en este archivo, como `MotivoField`/`CausaField`: un solo
 * consumidor (docs/architecture.md "sin sobre-ingeniería"). Ofrece selección múltiple, una
 * previsualización por foto y un botón para quitarla individualmente antes de enviar. El nombre
 * accesible del input lo da `ariaLabel` (mismo contrato que el input único anterior, para no
 * romper a quien lo localiza por ese nombre). El tope y la concatenación los aplica el padre en
 * `onSelect`; aquí sólo se pinta el estado (`files`) y se avisa del límite.
 */
function EvidenciasField({
  inputId,
  label,
  ariaLabel,
  files,
  error,
  onSelect,
  onRemove,
}: {
  inputId: string;
  label: string;
  ariaLabel: string;
  files: File[];
  error: string | undefined;
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}) {
  // Una object URL por foto para la previsualización (R15). Se derivan con `useMemo` (sin
  // `setState` en efecto) y sólo se recalculan cuando cambia `files` —que sólo cambia de
  // referencia cuando el padre agrega/quita una foto, no en cada re-render—. El efecto de
  // limpieza REVOCA el lote anterior al cambiar la lista (quitar una foto) y al desmontar, para
  // no fugar memoria.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos de evidencia seleccionadas">
          {previews.map((url, i) => (
            <li key={url} className="relative">
              {/* Vista previa local de un object URL: next/image no aplica a un blob del cliente. */}
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
        aria-label={ariaLabel}
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        {`Puedes adjuntar hasta ${MAX_EVIDENCIAS} fotos (${files.length}/${MAX_EVIDENCIAS}).`}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MotivoField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="gestion-motivo">Motivo</Label>
      <textarea
        id="gestion-motivo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-label="Motivo"
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
