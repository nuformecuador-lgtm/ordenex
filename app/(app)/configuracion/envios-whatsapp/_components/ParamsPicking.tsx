"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, type RadioGroupOption } from "@/components/ui/radio-group";
import { FieldError } from "@/components/shared/FieldError";
import { listarTiendasPicking } from "@/lib/actions/informe-picking";
import {
  DIAS_ATRASO_POR_DEFECTO,
  diasAtrasoSchema,
} from "@/lib/whatsapp-envios/informes/picking/parametros";
import type { ListarTiendasPickingResult, TiendaPickingDTO } from "@/lib/whatsapp-envios/informes/picking/tipos";

import {
  RANGO_DIAS,
  TEXTOS_PICKING as T,
  atrasadas,
  dias,
  mensajeDeCampoPicking,
  ordenes,
} from "./picking-textos";

export interface ParamsPickingProps {
  /** Título del panel (la `etiqueta` del descriptor). */
  etiqueta: string;
  /** La `ayuda` del descriptor («Solo aparecen las tiendas con fulfillment…»). */
  ayuda?: string;
  /** TODOS los parámetros del informe (`tiendaId`, `diasAtraso`). */
  valores: Record<string, unknown>;
  onCambiar: (campo: string, valor: unknown) => void;
  /**
   * m4 (revisión 475): completar un valor de partida que falta (`diasAtraso` en un envío guardado
   * sin él) NO es una edición del maestro y no debe dejar el formulario «con cambios». Sin él, va por
   * `onCambiar`.
   */
  onNormalizar?: (campo: string, valor: unknown) => void;
  /** Errores del servidor al guardar, ya filtrados a `parametros.tiendaId|diasAtraso`. */
  errores: Record<string, string[]>;
  /** Espera tras el último cambio de N antes de volver a pedir los conteos (mismo criterio que la 475). */
  retardoMs?: number;
}

/** La lista recibida, atada al N con el que se pidió: con otro N, sus conteos ya no valen. */
type Lista =
  | { tipo: "ok"; dias: number; tiendas: TiendaPickingDTO[] }
  | { tipo: "sin_permiso" }
  | { tipo: "invalido"; dias: number; mensajes: string[] };

/** Las claves de error del servidor que pinta este panel, SIN el prefijo `parametros.`. */
function soloDelPanel(errores: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(errores)) {
    const ruta = k.startsWith("parametros.") ? k.slice("parametros.".length) : k;
    const raiz = ruta.split(".")[0];
    if (raiz === "tiendaId" || raiz === "diasAtraso") (out[raiz] ??= []).push(...v);
  }
  return out;
}

function listaDe(r: ListarTiendasPickingResult, n: number): Lista {
  if (r.status === "ok") return { tipo: "ok", dias: n, tiendas: r.tiendas };
  if (r.status === "validation_error") {
    return { tipo: "invalido", dias: n, mensajes: mensajeDeCampoPicking("diasAtraso", r.fieldErrors.diasAtraso ?? []) };
  }
  return { tipo: "sin_permiso" };
}

/**
 * Ficha 476 (R3, T5.1, maqueta `ParamsPicking.dc.html` / `FormularioMovil.dc.html`) — el panel de
 * parámetros del informe de picking, dentro del formulario de un envío (474).
 *
 * - UNA tienda por envío (D1): selector de una sola elección, solo las tiendas que devuelve
 *   `listarTiendasPicking` (con fulfillment y activas), ya ordenadas por nombre.
 * - Junto a cada tienda, sus órdenes en preparación y cuántas van atrasadas con el N del formulario.
 *   Al cambiar N (válido) se vuelve a pedir tras `retardoMs`; una respuesta que llega tarde (de un N
 *   anterior) se DESCARTA: los conteos que se pintan son siempre los del N que se ve.
 * - Sin tiendas ⇒ estado vacío claro. Errores junto a su campo.
 */
export function ParamsPicking({
  etiqueta,
  ayuda,
  valores,
  onCambiar,
  onNormalizar,
  errores,
  retardoMs = 400,
}: ParamsPickingProps) {
  const base = useId();
  const cuerpoId = `${base}-cuerpo`;
  const diasId = `${base}-dias`;
  const [plegado, setPlegado] = useState(false);
  const [lista, setLista] = useState<Lista | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const [intento, setIntento] = useState(0);
  // Los errores del último «Guardar» valen hasta que se toca el panel: luego manda la validación viva.
  const clavesErrores = JSON.stringify(errores);
  const [tocadoCon, setTocadoCon] = useState<string | null>(null);
  const mostrarServidor = tocadoCon !== clavesErrores;
  // Número de la última petición lanzada: la respuesta de cualquier otra llega tarde y se descarta.
  const ultimaPeticion = useRef(0);

  const tiendaId = typeof valores.tiendaId === "string" ? valores.tiendaId : "";
  const diasCrudo = valores.diasAtraso;
  const faltaDias = diasCrudo === undefined;
  const validacion = diasAtrasoSchema.safeParse(faltaDias ? DIAS_ATRASO_POR_DEFECTO : diasCrudo);
  const n = validacion.success ? validacion.data : null;

  // m4: un envío guardado sin `diasAtraso` recibe la partida SIN quedar «con cambios».
  useEffect(() => {
    if (faltaDias) (onNormalizar ?? onCambiar)("diasAtraso", DIAS_ATRASO_POR_DEFECTO);
    // Solo cuando falta: completar no depende de la identidad de los callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faltaDias]);

  const yaPedido = lista !== null && lista.tipo !== "sin_permiso" && lista.dias === n;
  const primeraCarga = lista === null;
  useEffect(() => {
    if (n === null || yaPedido || lista?.tipo === "sin_permiso") return;
    const id = ++ultimaPeticion.current;
    let vivo = true;
    const pedir = () => {
      listarTiendasPicking({ diasAtraso: n }).then(
        (r) => {
          if (!vivo || id !== ultimaPeticion.current) return;
          setErrorCarga(false);
          setLista(listaDe(r, n));
        },
        () => {
          if (!vivo || id !== ultimaPeticion.current) return;
          setErrorCarga(true);
        },
      );
    };
    // La primera carga va en el acto; los cambios de N esperan a que se deje de escribir.
    const t = primeraCarga ? null : setTimeout(pedir, retardoMs);
    if (primeraCarga) pedir();
    return () => {
      vivo = false;
      if (t !== null) clearTimeout(t);
    };
    // `lista` entra por `yaPedido`/`primeraCarga`; `intento` re-dispara tras un error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, yaPedido, primeraCarga, intento, retardoMs]);

  function reintentar() {
    setErrorCarga(false);
    setIntento((i) => i + 1);
  }

  function cambiar(campo: string, valor: unknown) {
    setTocadoCon(clavesErrores);
    onCambiar(campo, valor);
  }

  // --- errores por campo -------------------------------------------------------------------
  const servidor = mostrarServidor ? soloDelPanel(errores) : {};
  const errTienda = servidor.tiendaId ? mensajeDeCampoPicking("tiendaId", servidor.tiendaId) : undefined;
  const errDias = !validacion.success
    ? mensajeDeCampoPicking("diasAtraso", [])
    : lista?.tipo === "invalido" && lista.dias === n
      ? lista.mensajes
      : servidor.diasAtraso
        ? mensajeDeCampoPicking("diasAtraso", servidor.diasAtraso)
        : undefined;

  // --- tiendas ------------------------------------------------------------------------------
  const tiendas = lista?.tipo === "ok" ? lista.tiendas : null;
  const conteosVigentes = lista?.tipo === "ok" && lista.dias === n;
  const opciones: RadioGroupOption[] = (tiendas ?? []).map((t) => ({
    value: t.tiendaId,
    label: t.nombre,
    detalle: (
      <span data-testid={`conteo-${t.tiendaId}`}>
        {n === null ? (
          ordenes(t.ordenes)
        ) : !conteosVigentes ? (
          T.calculando
        ) : (
          <>
            {ordenes(t.ordenes)} ·{" "}
            <span
              className={
                t.atrasadas > 0
                  ? "inline-flex h-5 items-center rounded-full bg-amber-100 px-2 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  : ""
              }
            >
              {atrasadas(t.atrasadas)}
            </span>
          </>
        )}
      </span>
    ),
  }));
  const guardadaFuera = tiendas !== null && tiendaId !== "" && !tiendas.some((t) => t.tiendaId === tiendaId);
  const tiendaErrorId = `${base}-tienda-error`;
  const ayudaTiendaId = `${base}-tienda-ayuda`;

  let cuerpoTiendas;
  if (errorCarga && tiendas === null) {
    cuerpoTiendas = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-destructive">
          {T.errorTiendas}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={reintentar}>
          {T.reintentar}
        </Button>
      </div>
    );
  } else if (lista?.tipo === "sin_permiso") {
    cuerpoTiendas = <p className="text-sm text-muted-foreground">{T.sinPermiso}</p>;
  } else if (tiendas === null) {
    cuerpoTiendas = (
      <p role="status" className="text-sm text-muted-foreground">
        {T.cargandoTiendas}
      </p>
    );
  } else if (tiendas.length === 0) {
    cuerpoTiendas = (
      <p role="status" data-testid="picking-sin-tiendas" className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        {T.sinTiendas}
      </p>
    );
  } else {
    cuerpoTiendas = (
      <RadioGroup
        aria-label={T.tiendaTitulo}
        aria-invalid={errTienda || guardadaFuera ? true : undefined}
        value={guardadaFuera ? "" : tiendaId}
        options={opciones}
        onValueChange={(v) => cambiar("tiendaId", v)}
      />
    );
  }

  return (
    <section aria-labelledby={`${base}-titulo`} className="flex flex-col rounded-lg border border-border bg-background p-3 sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 id={`${base}-titulo`} className="text-base font-semibold">
          {etiqueta}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={!plegado}
          aria-controls={cuerpoId}
          onClick={() => setPlegado((p) => !p)}
        >
          {plegado ? T.desplegar : T.plegar}
        </Button>
      </div>

      <div id={cuerpoId} hidden={plegado} className="flex flex-col">
        <p className="mb-4 text-sm text-muted-foreground">{T.intro}</p>

        {/* Tienda (R3) */}
        <p className="mb-1.5 text-sm font-medium">{T.tiendaTitulo}</p>
        {cuerpoTiendas}
        <p id={ayudaTiendaId} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {ayuda ? `${ayuda} ` : ""}
          {T.ayudaTiendaVacia}
        </p>
        {guardadaFuera ? (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {T.tiendaYaNoEsta}
          </p>
        ) : null}
        {errTienda ? <FieldError id={tiendaErrorId} messages={errTienda} /> : null}
        {errorCarga && tiendas !== null ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              {T.errorTiendas}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reintentar}>
              {T.reintentar}
            </Button>
          </div>
        ) : null}

        {/* Días para marcar atrasada */}
        <div className="mt-4 border-t border-border pt-4">
          <Label htmlFor={diasId} className="mb-1.5 text-sm font-medium">
            {T.atrasoTitulo}
          </Label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden="true">{T.atrasoAntes}</span>
            <Input
              id={diasId}
              type="number"
              inputMode="numeric"
              step={1}
              min={RANGO_DIAS.min}
              max={RANGO_DIAS.max}
              aria-invalid={errDias ? true : undefined}
              aria-describedby={errDias ? `${diasId}-error` : `${diasId}-ayuda`}
              className="h-11 w-16 text-right font-mono sm:h-8"
              value={diasCrudo === undefined || diasCrudo === null ? "" : String(diasCrudo)}
              onChange={(e) => {
                const t = e.target.value;
                cambiar("diasAtraso", t.trim() === "" ? null : Number(t));
              }}
            />
            <span aria-hidden="true">
              {dias(n)} {T.atrasoDespues}
            </span>
          </div>
          <p id={`${diasId}-ayuda`} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {T.ayudaAtraso}
          </p>
          {errDias ? <FieldError id={`${diasId}-error`} messages={errDias} /> : null}
          {n === null && tiendas !== null && tiendas.length > 0 ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {T.corrigeDias}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
