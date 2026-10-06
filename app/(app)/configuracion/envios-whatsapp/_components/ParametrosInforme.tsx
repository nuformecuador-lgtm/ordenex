"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/shared/FieldError";
import type { InformeDTO } from "@/lib/types/envios-whatsapp";

type Descriptor = InformeDTO["descriptores"][number];

export interface ParametrosInformeProps {
  informe: InformeDTO;
  valores: Record<string, unknown>;
  onCambiar: (campo: string, valor: unknown) => void;
  /** Errores por campo del backend, con la clave `parametros.<campo>` (R13). */
  errores: Record<string, string[]>;
}

/**
 * Ficha 474 (R13) — el panel «Parámetros del informe», pintado desde los DESCRIPTORES que declara
 * el informe (design §2), no a mano por informe: así 475/476 solo declaran y la pantalla obedece.
 *
 * Tipos que sabe pintar hoy: entero/decimal, booleano, texto y selección de opciones FIJAS. Las
 * opciones de catálogo (`zonas`, `tiendas`, `estados_orden`) y las tablas las necesitan 475/476, y
 * design §2 dice que las añaden ellas al renderizador; mientras, se dice en claro en vez de pintar
 * un control que no guarda nada.
 *
 * Un informe sin descriptores («Aviso de la app») no pinta el panel.
 */
export function ParametrosInforme({ informe, valores, onCambiar, errores }: ParametrosInformeProps) {
  if (informe.descriptores.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-sm font-medium">Parámetros del informe «{informe.nombre}»</p>
      {informe.descriptores.map((d) => (
        <CampoParametro
          key={d.campo}
          descriptor={d}
          valor={valores[d.campo]}
          onCambiar={(v) => onCambiar(d.campo, v)}
          error={errores[`parametros.${d.campo}`]}
        />
      ))}
      {errores.parametros ? <FieldError id="parametros-error" messages={errores.parametros} /> : null}
    </div>
  );
}

function CampoParametro({
  descriptor: d,
  valor,
  onCambiar,
  error,
}: {
  descriptor: Descriptor;
  valor: unknown;
  onCambiar: (v: unknown) => void;
  error?: string[];
}) {
  const id = `parametro-${d.campo}`;
  const ayudaId = d.ayuda ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [ayudaId, errorId].filter(Boolean).join(" ") || undefined;

  if (d.tipo === "booleano") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id}>{d.etiqueta}</Label>
          <Switch
            id={id}
            aria-label={d.etiqueta}
            aria-describedby={describedBy}
            checked={valor === true}
            onCheckedChange={(c) => onCambiar(c)}
          />
        </div>
        {d.ayuda ? (
          <p id={ayudaId} className="text-sm text-muted-foreground">
            {d.ayuda}
          </p>
        ) : null}
        {error ? <FieldError id={errorId} messages={error} /> : null}
      </div>
    );
  }

  if (d.tipo === "entero" || d.tipo === "decimal" || d.tipo === "texto") {
    const numerico = d.tipo !== "texto";
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{d.etiqueta}</Label>
        <Input
          id={id}
          type={numerico ? "number" : "text"}
          inputMode={d.tipo === "entero" ? "numeric" : d.tipo === "decimal" ? "decimal" : undefined}
          step={d.tipo === "entero" ? 1 : d.tipo === "decimal" ? "any" : undefined}
          min={numerico && "min" in d ? d.min : undefined}
          max={numerico && "max" in d ? d.max : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="max-w-48"
          value={valor === undefined || valor === null ? "" : String(valor)}
          onChange={(e) => {
            const t = e.target.value;
            if (!numerico) onCambiar(t);
            else onCambiar(t === "" ? null : Number(t));
          }}
        />
        {d.ayuda ? (
          <p id={ayudaId} className="text-sm text-muted-foreground">
            {d.ayuda}
          </p>
        ) : null}
        {error ? <FieldError id={errorId} messages={error} /> : null}
      </div>
    );
  }

  if ((d.tipo === "seleccion" || d.tipo === "seleccion_multiple") && d.opciones.origen === "fija") {
    const multiple = d.tipo === "seleccion_multiple";
    const elegidos = multiple ? (Array.isArray(valor) ? (valor as string[]) : []) : [];
    return (
      <fieldset className="flex flex-col gap-1" aria-describedby={describedBy}>
        <legend className="mb-1 text-sm font-medium">{d.etiqueta}</legend>
        {d.opciones.valores.map((o) => {
          const marcado = multiple ? elegidos.includes(o.valor) : valor === o.valor;
          return (
            <label key={o.valor} className="flex min-h-9 items-center gap-2 text-sm">
              <Checkbox
                checked={marcado}
                onCheckedChange={(c) => {
                  if (!multiple) onCambiar(c ? o.valor : null);
                  else onCambiar(c ? [...elegidos, o.valor] : elegidos.filter((x) => x !== o.valor));
                }}
              />
              {o.etiqueta}
            </label>
          );
        })}
        {d.ayuda ? (
          <p id={ayudaId} className="text-sm text-muted-foreground">
            {d.ayuda}
          </p>
        ) : null}
        {error ? <FieldError id={errorId} messages={error} /> : null}
      </fieldset>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      «{d.etiqueta}» todavía no se puede editar desde esta pantalla: se usa el valor de partida del informe.
    </p>
  );
}
