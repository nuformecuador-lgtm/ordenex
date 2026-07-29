"use client";

import { useId, useState, type ReactNode } from "react";
import { CheckCircle2, Package, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QrScanner } from "@/components/shared/QrScanner";
import { cn } from "@/lib/utils";

/** Entrada manual del número de guía, para las superficies que la ofrecen. */
export interface EscanerGuiaManual {
  /**
   * Recibe el texto tecleado (ya sin espacios). Devolver `false` deja el valor en el
   * campo para reintentar; cualquier otra cosa lo limpia.
   */
  onSubmit: (valor: string) => void | boolean | Promise<void | boolean>;
  /** Texto del botón de confirmación ("Recibir", "Recoger"…). */
  submitLabel: string;
  label?: string;
  placeholder?: string;
}

export interface EscanerGuiaCardProps {
  /** Título de la tarjeta ("Recibir paquete"). */
  titulo: string;
  /** Una línea que dice qué hacer ("Escanea o ingresa el número de guía"). */
  descripcion: string;
  /** Texto decodificado por la cámara. El significado lo pone el consumidor. */
  onDecoded: (texto: string) => void;
  /** Bloquea los dos caminos mientras el consumidor procesa. */
  procesando?: boolean;
  mensajeErrorCamara?: string;
  /** Ausente = solo cámara (la superficie no acepta el número tecleado). */
  manual?: EscanerGuiaManual;
  /** Confirmación del último acierto, bajo el formulario. */
  exito?: ReactNode;
  /** Icono del encabezado. */
  icono?: LucideIcon;
  /** Nombre accesible de la tarjeta como region. Por defecto, el título. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Tarjeta de captura de una guía: **cámara o número tecleado**, los dos caminos que
 * toda superficie de escaneo del producto ofrece (recepción en satélite, en tienda,
 * en bodega central, recogida del mensajero).
 *
 * Es solo la CARCASA: la cámara sigue siendo `QrScanner` (html5-qrcode, un único
 * ciclo de vida en todo el repo) y el significado del texto decodificado —a qué
 * Server Action va, qué toast sale— lo pone cada consumidor. Esta tarjeta no sabe
 * qué es una orden.
 *
 * Sin `manual` se degrada a solo cámara, sin separador ni formulario: la superficie
 * que no acepta el número tecleado no lo insinúa.
 */
export function EscanerGuiaCard({
  titulo,
  descripcion,
  onDecoded,
  procesando = false,
  mensajeErrorCamara,
  manual,
  exito,
  icono: Icono = Package,
  ariaLabel,
  className,
}: Readonly<EscanerGuiaCardProps>) {
  const inputId = useId();
  const [valor, setValor] = useState("");

  async function enviarManual() {
    if (!manual) return;
    const texto = valor.trim();
    if (texto === "") return;
    const resultado = await manual.onSubmit(texto);
    if (resultado !== false) setValor("");
  }

  return (
    <section
      aria-label={ariaLabel ?? titulo}
      className={cn(
        "w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icono className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg leading-tight font-semibold text-balance text-card-foreground">
            {titulo}
          </h2>
          <p className="text-sm text-muted-foreground">{descripcion}</p>
        </div>
      </div>

      <div className="mt-6">
        <QrScanner
          onDecoded={onDecoded}
          disabled={procesando}
          mensajeErrorCamara={mensajeErrorCamara}
        />
      </div>

      {manual ? (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              o ingresa manualmente
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void enviarManual();
            }}
          >
            <div className="space-y-1.5">
              <label
                htmlFor={inputId}
                className="text-sm font-medium text-card-foreground"
              >
                {manual.label ?? "Número de guía"}
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                {/* Sin `type="number"` a proposito: dispararia la validacion nativa
                    del form y se tragaria el corte limpio del consumidor ("Código
                    inválido") antes de que este lo pueda reportar. */}
                <input
                  id={inputId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={valor}
                  disabled={procesando}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder={manual.placeholder ?? "Ej. 1024"}
                  className="h-11 flex-1 rounded-lg border border-input bg-background px-3.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button
                  type="submit"
                  size="lg"
                  loading={procesando}
                  disabled={valor.trim() === ""}
                  className="h-11 shrink-0 px-6"
                >
                  {manual.submitLabel}
                </Button>
              </div>
            </div>
          </form>
        </>
      ) : null}

      {exito ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-sm text-card-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{exito}</span>
        </p>
      ) : null}
    </section>
  );
}
