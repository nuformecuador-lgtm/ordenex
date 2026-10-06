"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { InfoEstado } from "@/components/shared/EstadoInfo";
import { FieldError } from "@/components/shared/FieldError";
import { previsualizarInformeTransito } from "@/lib/actions/informe-transito";
import { nombreDeEstado } from "@/lib/types/order-status";
import {
  ESTADOS_OFRECIDOS,
  PARADO_MAX,
  PARADO_MIN,
  PARAMETROS_POR_DEFECTO,
  PLAZO_MAX,
  PLAZO_MIN,
  erroresDeParametrosTransito,
  parametrosTransitoSchema,
  plazoEfectivo,
  umbralDeAlerta,
  type EstadoOfrecido,
} from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { PrevisualizarTransitoResult, ZonaPanel } from "@/lib/whatsapp-envios/informes/transito/tipos";

import {
  OPCIONES_HITO,
  TEXTOS_TRANSITO as T,
  dias,
  mensajeDeCampo,
  paquetes,
  textoEntraEnAlerta,
  textoParados,
  textoSinHito,
} from "./transito-textos";

/** Una fila de zona tal como vive en el formulario: mientras se escribe, un número puede faltar. */
interface ZonaEditable {
  zonaId: string;
  plazoDias: number | null;
  avisoDias: number | null;
}

interface EstadoEditable {
  estado: string;
  incluido: boolean;
  paradoSiMasDeDias: number | null;
}

type Vista =
  | { tipo: "cargando" }
  | { tipo: "calculando" }
  | { tipo: "ok"; total: number; parados: number; sinHito: number }
  | { tipo: "invalido"; fieldErrors: Record<string, string[]> }
  | { tipo: "error" }
  | { tipo: "sin_permiso" };

export interface ParamsTransitoProps {
  /** Título del panel (la `etiqueta` del descriptor). */
  etiqueta: string;
  /** TODOS los parámetros del informe (hito, zonas, estados, enviarSiVacio). */
  valores: Record<string, unknown>;
  onCambiar: (campo: string, valor: unknown) => void;
  /**
   * m4 (revisión 475): el relleno de R35 al montar (zonas sin entrada → su partida) va por aquí, no
   * por `onCambiar`: no es una edición del maestro y no debe dejar el formulario «con cambios». Sin
   * él, va por `onCambiar`.
   */
  onNormalizar?: (campo: string, valor: unknown) => void;
  /** Errores del servidor al guardar, ya filtrados a `parametros.hito|zonas|estados…`. */
  errores: Record<string, string[]>;
  /** Espera tras el último cambio antes de pedir el conteo (design §8.2: 400 ms). */
  retardoMs?: number;
}

const CAMPOS_DEL_PANEL = ["hito", "zonas", "estados"];

function vistaDe(r: PrevisualizarTransitoResult): Vista {
  if (r.status === "ok") return { tipo: "ok", total: r.totalEnAlerta, parados: r.parados, sinHito: r.sinHito };
  if (r.status === "validation_error") return { tipo: "invalido", fieldErrors: r.fieldErrors };
  return { tipo: "sin_permiso" };
}

function entero(t: string): number | null {
  return t.trim() === "" ? null : Number(t);
}

function esPlazoValido(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= PLAZO_MIN && n <= PLAZO_MAX;
}

function comoZonas(v: unknown): ZonaEditable[] {
  return Array.isArray(v) ? (v as ZonaEditable[]) : [];
}

function comoEstados(v: unknown): EstadoEditable[] {
  return Array.isArray(v) ? (v as EstadoEditable[]) : [];
}

/** R35 — la entrada de una zona: la suya si la tiene; si no, la partida de su tipo. */
function entradaDe(zona: ZonaPanel, zonasParam: readonly ZonaEditable[]): ZonaEditable {
  const propia = zonasParam.find((z) => z.zonaId === zona.id);
  if (propia) return { zonaId: zona.id, plazoDias: propia.plazoDias, avisoDias: propia.avisoDias };
  return { zonaId: zona.id, ...plazoEfectivo(zona, { zonas: [] }) };
}

/** Solo los errores de lo que edita el panel, con la clave SIN `parametros.`. */
function soloDelPanel(errores: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(errores)) {
    const ruta = k.startsWith("parametros.") ? k.slice("parametros.".length) : k;
    const raiz = ruta.split(".")[0];
    if (raiz !== undefined && CAMPOS_DEL_PANEL.includes(raiz)) out[ruta] = v;
  }
  return out;
}

/**
 * Ficha 475 (R34–R38, design §8.2, maqueta `ParamsTransito.dc.html`) — el panel de parámetros del
 * informe de tránsito, dentro del formulario de un envío (474).
 *
 * - Las zonas son las REALES, leídas por la vista previa al montar; cada una sin plazo propio se
 *   rellena con la partida de su tipo y se guarda con todas (R35).
 * - «Entra en alerta el día N» y la partida salen de las MISMAS funciones puras que usa el informe
 *   (`plazoEfectivo`, `umbralDeAlerta`): lo que se pinta no puede divergir de lo que se filtra.
 * - Conteo (R38): con valores válidos, tras `retardoMs` sin cambios se pregunta al servidor (solo
 *   lectura); con valores inválidos se dicen los errores por campo y NO se muestra conteo.
 */
export function ParamsTransito({ etiqueta, valores, onCambiar, onNormalizar, errores, retardoMs = 400 }: ParamsTransitoProps) {
  const base = useId();
  const cuerpoId = `${base}-cuerpo`;
  const [plegado, setPlegado] = useState(false);
  const [zonas, setZonas] = useState<ZonaPanel[] | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const [intentoCarga, setIntentoCarga] = useState(0);
  // El último conteo recibido, atado a los valores con los que se pidió: si cambian, deja de valer.
  const [resultado, setResultado] = useState<{ clave: string; vista: Vista } | null>(null);
  // Los errores del último «Guardar» valen hasta que se toca el panel: luego manda la validación viva.
  const clavesErrores = JSON.stringify(errores);
  const [tocadoCon, setTocadoCon] = useState<string | null>(null);
  const mostrarServidor = tocadoCon !== clavesErrores;

  const valoresRef = useRef(valores);
  useEffect(() => {
    valoresRef.current = valores;
  });

  const clave = JSON.stringify(valores);
  const validacion = useMemo(() => parametrosTransitoSchema.safeParse(valores), [valores]);
  const zonasParam = comoZonas(valores.zonas);
  const estadosParam = comoEstados(valores.estados);
  const hito = typeof valores.hito === "string" ? valores.hito : "";

  // Al montar (y al reintentar): zonas reales + primer conteo, en UNA llamada de solo lectura.
  useEffect(() => {
    let vivo = true;
    previsualizarInformeTransito(valoresRef.current).then(
      (r) => {
        if (!vivo) return;
        const reales = r.status === "ok" || r.status === "validation_error" ? r.zonas : [];
        // R35: una entrada por cada zona mostrada. Rellenar no cambia el conteo (es la misma partida
        // que el servidor aplica a una zona sin entrada), así que el resultado vale para lo relleno.
        const actuales = valoresRef.current;
        const llenas = reales.map((z) => entradaDe(z, comoZonas(actuales.zonas)));
        const rellenar = reales.length > 0 && JSON.stringify(llenas) !== JSON.stringify(actuales.zonas);
        setResultado({ clave: JSON.stringify(rellenar ? { ...actuales, zonas: llenas } : actuales), vista: vistaDe(r) });
        setZonas(reales);
        if (rellenar) (onNormalizar ?? onCambiar)("zonas", llenas);
      },
      () => {
        if (vivo) setErrorCarga(true);
      },
    );
    return () => {
      vivo = false;
    };
    // Solo al montar y al reintentar; los cambios posteriores los lleva el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentoCarga]);

  const cargado = zonas !== null;
  const yaContado = resultado?.clave === clave;
  // R38: con valores válidos, tras `retardoMs` sin cambios, se vuelve a contar.
  useEffect(() => {
    if (!cargado || !validacion.success || yaContado) return;
    let vivo = true;
    const t = setTimeout(() => {
      previsualizarInformeTransito(valores).then(
        (r) => {
          if (vivo) setResultado({ clave, vista: vistaDe(r) });
        },
        () => {
          if (vivo) setResultado({ clave, vista: { tipo: "error" } });
        },
      );
    }, retardoMs);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [cargado, validacion.success, yaContado, clave, valores, retardoMs]);

  const vista: Vista = errorCarga
    ? { tipo: "error" }
    : !cargado
      ? { tipo: "cargando" }
      : !validacion.success
        ? { tipo: "invalido", fieldErrors: {} }
        : yaContado && resultado
          ? resultado.vista
          : { tipo: "calculando" };

  function reintentar() {
    setErrorCarga(false);
    setIntentoCarga((n) => n + 1);
  }

  // Errores por campo: la validación viva manda; los del servidor, hasta el siguiente cambio.
  const errs: Record<string, string[]> = {
    ...(mostrarServidor ? soloDelPanel(errores) : {}),
    ...(validacion.success ? {} : soloDelPanel(erroresDeParametrosTransito(validacion.error))),
    ...(vista.tipo === "invalido" ? soloDelPanel(vista.fieldErrors) : {}),
  };
  const colocadas = new Set<string>();
  function errorEn(ruta: string, contexto?: { plazo?: unknown }): string[] | undefined {
    const m = errs[ruta];
    if (!m || m.length === 0) return undefined;
    colocadas.add(ruta);
    return mensajeDeCampo(ruta, m, contexto);
  }

  function cambiar(campo: string, valor: unknown) {
    setTocadoCon(clavesErrores);
    onCambiar(campo, valor);
  }

  const reales = zonas ?? [];
  function cambiarZona(id: string, campo: "plazoDias" | "avisoDias", valor: number | null) {
    cambiar(
      "zonas",
      reales.map((z) => {
        const e = entradaDe(z, zonasParam);
        return z.id === id ? { ...e, [campo]: valor } : e;
      }),
    );
  }

  const filasEstado: EstadoEditable[] = ESTADOS_OFRECIDOS.map(
    (e) => estadosParam.find((x) => x.estado === e) ?? { estado: e, incluido: false, paradoSiMasDeDias: null },
  );
  function cambiarEstado(estado: EstadoOfrecido, cambio: Partial<EstadoEditable>) {
    cambiar(
      "estados",
      filasEstado.map((f) => (f.estado === estado ? { ...f, ...cambio } : f)),
    );
  }

  function volverAPartida() {
    cambiar("hito", PARAMETROS_POR_DEFECTO.hito);
    cambiar(
      "zonas",
      reales.map((z) => ({ zonaId: z.id, ...plazoEfectivo(z, { zonas: [] }) })),
    );
    cambiar(
      "estados",
      PARAMETROS_POR_DEFECTO.estados.map((e) => ({ ...e })),
    );
  }

  // --- zonas -------------------------------------------------------------------------------
  const filasZona = reales.map((z) => {
    const idx = zonasParam.findIndex((x) => x.zonaId === z.id);
    const e = entradaDe(z, zonasParam);
    const plazoErr = idx >= 0 ? errorEn(`zonas.${idx}.plazoDias`) : undefined;
    const avisoErr = idx >= 0 ? errorEn(`zonas.${idx}.avisoDias`, { plazo: e.plazoDias }) : undefined;
    const otros =
      idx >= 0
        ? Object.keys(errs)
            .filter((k) => k.startsWith(`zonas.${idx}.`) && !colocadas.has(k))
            .flatMap((k) => errorEn(k) ?? [])
        : [];
    const alerta =
      esPlazoValido(e.plazoDias) && typeof e.avisoDias === "number" && Number.isInteger(e.avisoDias) && e.avisoDias >= 0 && e.avisoDias < e.plazoDias
        ? umbralDeAlerta({ plazoDias: e.plazoDias, avisoDias: e.avisoDias })
        : null;
    const pid = `${base}-zona-${z.id}-plazo`;
    const aid = `${base}-zona-${z.id}-aviso`;
    return (
      <li
        key={z.id}
        data-testid={`zona-${z.id}`}
        className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_6.5rem] sm:items-center sm:gap-y-0"
      >
        <span className={`col-span-2 text-sm sm:col-span-1 ${z.esCentral ? "font-medium" : ""}`}>{z.nombre}</span>
        <CampoDias
          id={pid}
          etiqueta={
            <>
              <span className="sm:sr-only">{T.colPlazo}</span>
              <span className="sr-only"> de {z.nombre}</span>
            </>
          }
          valor={e.plazoDias}
          min={PLAZO_MIN}
          max={PLAZO_MAX}
          onCambiar={(v) => cambiarZona(z.id, "plazoDias", v)}
          error={plazoErr}
        />
        <CampoDias
          id={aid}
          etiqueta={
            <>
              <span className="sm:sr-only">{T.colAviso}</span>
              <span className="sr-only"> en {z.nombre}</span>
            </>
          }
          valor={e.avisoDias}
          min={0}
          max={esPlazoValido(e.plazoDias) ? e.plazoDias - 1 : undefined}
          onCambiar={(v) => cambiarZona(z.id, "avisoDias", v)}
          error={avisoErr}
        />
        <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">
          <span className="sm:sr-only">{T.colAlerta} </span>
          {textoEntraEnAlerta(alerta)}
        </span>
        {otros.length > 0 ? (
          <div className="col-span-2 sm:col-span-4">
            <FieldError messages={otros} />
          </div>
        ) : null}
      </li>
    );
  });

  // --- estados ----------------------------------------------------------------------------
  const filasEstados = filasEstado.map((f) => {
    const estado = f.estado as EstadoOfrecido;
    const idx = estadosParam.findIndex((x) => x.estado === estado);
    const paradoErr = idx >= 0 ? errorEn(`estados.${idx}.paradoSiMasDeDias`) : undefined;
    const otros =
      idx >= 0
        ? Object.keys(errs)
            .filter((k) => k.startsWith(`estados.${idx}.`) && !colocadas.has(k))
            .flatMap((k) => errorEn(k) ?? [])
        : [];
    const nombre = nombreDeEstado(estado);
    const nid = `${base}-estado-${estado}`;
    return (
      <li
        key={estado}
        data-testid={`estado-${estado}`}
        className={`flex flex-col gap-1 border-b border-border py-2 last:border-b-0 ${f.incluido ? "" : "text-muted-foreground"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm">
            <Checkbox
              checked={f.incluido}
              onCheckedChange={(c) => {
                const incluido = c === true;
                const p = f.paradoSiMasDeDias;
                const pValido = p === null || (Number.isInteger(p) && p >= PARADO_MIN && p <= PARADO_MAX);
                // Un umbral inválido no puede quedar bloqueado tras un número deshabilitado (R37).
                cambiarEstado(estado, incluido || pValido ? { incluido } : { incluido, paradoSiMasDeDias: null });
              }}
            />
            <span className="min-w-0">{nombre}</span>
          </label>
          {/* Guardia 456: el nombre de un estado va con su botón de información, como hermano. */}
          <InfoEstado codigo={estado} />
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <Label htmlFor={nid} className="sr-only">
              {T.colParado} (días), {nombre}
            </Label>
            <Input
              id={nid}
              type="number"
              inputMode="numeric"
              step={1}
              min={PARADO_MIN}
              max={PARADO_MAX}
              placeholder="—"
              disabled={!f.incluido}
              aria-invalid={paradoErr ? true : undefined}
              aria-describedby={paradoErr ? `${nid}-error` : undefined}
              className="h-8 w-16 text-right font-mono"
              value={f.paradoSiMasDeDias === null || f.paradoSiMasDeDias === undefined ? "" : String(f.paradoSiMasDeDias)}
              onChange={(ev) => cambiarEstado(estado, { paradoSiMasDeDias: entero(ev.target.value) })}
            />
            <span className="w-14 text-xs">
              {f.incluido ? (f.paradoSiMasDeDias === null ? "" : dias(f.paradoSiMasDeDias)) : T.noEntra}
            </span>
          </div>
        </div>
        {paradoErr ? <FieldError id={`${nid}-error`} messages={paradoErr} /> : null}
        {otros.length > 0 ? <FieldError messages={otros} /> : null}
      </li>
    );
  });

  const hitoErr = errorEn("hito");
  const zonasErr = errorEn("zonas");
  const estadosErr = errorEn("estados");
  const resto = Object.keys(errs)
    .filter((k) => !colocadas.has(k))
    .flatMap((k) => mensajeDeCampo(k, errs[k] ?? []));

  return (
    <section
      aria-labelledby={`${base}-titulo`}
      className="flex flex-col rounded-lg border border-border bg-background p-3 sm:p-5"
    >
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

        {/* Plazo por zona (R34/R35) */}
        <p id={`${base}-zonas`} className="mb-1.5 text-sm font-medium">
          {T.plazoPorZona}
        </p>
        <div className="rounded-lg border border-border px-2">
          <div
            aria-hidden="true"
            className="hidden border-b border-border py-2 text-xs font-medium sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_6.5rem]"
          >
            <span>{T.colZona}</span>
            <span className="text-right">{T.colPlazo}</span>
            <span className="text-right">{T.colAviso}</span>
            <span className="text-right">{T.colAlerta}</span>
          </div>
          {errorCarga ? (
            <div className="flex flex-col items-start gap-2 py-3">
              <p role="alert" className="text-sm text-destructive">
                {T.errorZonas}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={reintentar}>
                {T.reintentar}
              </Button>
            </div>
          ) : zonas === null ? (
            <p role="status" className="py-3 text-sm text-muted-foreground">
              {T.cargandoZonas}
            </p>
          ) : zonas.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">{T.sinZonas}</p>
          ) : (
            <ul aria-labelledby={`${base}-zonas`}>{filasZona}</ul>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{T.ayudaZonas}</p>
        {zonasErr ? <FieldError messages={zonasErr} /> : null}

        {/* Hito (R34) */}
        <div className="mt-4 border-t border-border pt-4">
          <p id={`${base}-hito`} className="mb-1.5 text-sm font-medium">
            {T.hitoTitulo}
          </p>
          <RadioGroup
            aria-label={T.hitoTitulo}
            aria-invalid={hitoErr ? true : undefined}
            value={hito}
            options={OPCIONES_HITO}
            onValueChange={(v) => cambiar("hito", v)}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{T.ayudaHito}</p>
          {hitoErr ? <FieldError messages={hitoErr} /> : null}
        </div>

        {/* Estados + umbral de parado (R34/R37) */}
        <div className="mt-4 border-t border-border pt-4">
          <p id={`${base}-estados`} className="mb-1 text-sm font-medium">
            {T.estadosTitulo}
          </p>
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">{T.ayudaEstados}</p>
          <div className="rounded-lg border border-border px-2">
            <div aria-hidden="true" className="flex justify-between border-b border-border py-2 text-xs font-medium">
              <span>{T.colEstado}</span>
              <span>{T.colParado}</span>
            </div>
            <ul aria-labelledby={`${base}-estados`}>{filasEstados}</ul>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{T.cierreLogistico}</p>
          {estadosErr ? <FieldError messages={estadosErr} /> : null}
        </div>

        {resto.length > 0 ? (
          <div className="mt-3">
            <FieldError messages={resto} />
          </div>
        ) : null}

        {/* Conteo (R38) + volver a la partida (R36) */}
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div role="status" aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
            <Conteo vista={vista} />
          </div>
          <Button type="button" variant="outline" size="sm" className="self-start sm:self-auto" onClick={volverAPartida} disabled={zonas === null}>
            {T.volverPartida}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Conteo({ vista }: { vista: Vista }) {
  switch (vista.tipo) {
    case "cargando":
    case "calculando":
      return <span>{T.calculando}</span>;
    case "invalido":
      return <span>{T.conErrores}</span>;
    case "error":
      return <span className="text-destructive">{T.errorVistaPrevia}</span>;
    case "sin_permiso":
      return <span>{T.sinPermiso}</span>;
    case "ok":
      return (
        <span data-testid="conteo-transito">
          Con estos valores, hoy entrarían <strong className="text-foreground">{paquetes(vista.total)}</strong>{" "}
          {textoParados(vista.parados)}.
          {vista.sinHito > 0 ? <span className="block">{textoSinHito(vista.sinHito)}</span> : null}
        </span>
      );
  }
}

function CampoDias({
  id,
  etiqueta,
  valor,
  min,
  max,
  onCambiar,
  error,
}: {
  id: string;
  etiqueta: ReactNode;
  valor: number | null;
  min: number;
  max?: number;
  onCambiar: (v: number | null) => void;
  error?: string[];
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground sm:text-sm">
        {etiqueta}
      </Label>
      <div className="flex items-center gap-1.5 text-sm">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="h-8 w-16 text-right font-mono"
          value={valor === null || valor === undefined ? "" : String(valor)}
          onChange={(e) => onCambiar(entero(e.target.value))}
        />
        <span className="text-xs">{valor === null ? "días" : dias(valor)}</span>
      </div>
      {error ? <FieldError id={errorId} messages={error} /> : null}
    </div>
  );
}
