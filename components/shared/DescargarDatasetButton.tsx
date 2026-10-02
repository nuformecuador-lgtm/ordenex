"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColumnasPopover } from "@/components/shared/ColumnasPopover";
import { RadioGroup, type RadioGroupOption } from "@/components/ui/radio-group";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { usePreferenciaColumnas } from "@/hooks/usePreferenciaColumnas";
import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { DescargaColumna, DescargaHoja, DescargaTipo } from "@/lib/types/descarga";
import type { DataTableDescarga, DataTableDescargaDetalle } from "@/components/shared/DataTable";

/**
 * Feature 151 (design.md §5) — control de descarga del dataset completo de un
 * `DataTable`.
 *
 * Modelado sobre `DescargarManifiestoButton` pero SIN DOMINIO: no importa nada de
 * `lib/actions/`, `lib/services/`, `lib/types/orden` ni de `app/`. Su único insumo es
 * la configuración `DataTableDescarga` que le pasa la tabla: título, columnas de export,
 * una FUNCIÓN que obtiene las filas y los formatos permitidos. Quien conoce filtros,
 * roles y acciones es el consumidor, que los encierra en `obtenerFilas` (D4).
 *
 * El binario se arma en el NAVEGADOR y se entrega con `descargarBlob`: no se sube a
 * ningún servidor ni se almacena fuera del equipo del usuario (R32). El despachador
 * `descarga-dataset` (y con él `exceljs`) se carga con un `import()` DINÁMICO dentro del
 * handler, para no entrar en el bundle inicial de todas las pantallas con tabla.
 *
 * FICHA 314 — cuando la configuración declara `ambitoColumnas`, este control monta además el
 * selector de columnas (`ColumnasPopover`) y emite el archivo con las columnas MARCADAS y en
 * el orden que el usuario haya fijado en ese ámbito. Sin ámbito no hay selector y salen todas
 * las columnas declaradas (R33), que es lo que siguen haciendo las 24 tablas restantes.
 *
 * FICHA 464 (design §2.2) — cuando la configuración declara además `detalle`, el MISMO selector gana
 * arriba dos decisiones, con el molde de `DescargarCierresButton`: «Hojas del archivo» (solo la hoja
 * principal, o también la hoja de detalle) y, si van las dos, «Columnas de la hoja» (de cuál se eligen
 * las columnas que se listan debajo). Cada hoja guarda su elección en su propio ámbito (R2/R11); lo que
 * se descarga NO se guarda y arranca siempre con el detalle (R8). Con detalle el archivo es siempre
 * Excel (R12). Sin `detalle`, nada de esto existe (R41).
 *
 * FICHA 468 (design §6) — las dos columnas fijas de la 464 («N.º» y «Detalle por orden») desaparecen.
 * En su lugar, cada hoja declara `columnasFijas`: claves de SU catálogo que el selector lista marcadas
 * y deshabilitadas (R51) y que salen siempre en el archivo, en el orden elegido, aunque una preferencia
 * guardada antes las ocultara (R52). Y la respuesta puede traer `filasDestacadas` por hoja (negritas,
 * R23/R47), que se pasan tal cual al generador.
 */
export interface DescargarDatasetButtonProps extends DataTableDescarga {
  /** Texto del botón (i18n por prop, sin literal fijo en el consumidor). */
  label?: string;
  /** Clases extra, para encajar el control en la barra de acciones del consumidor. */
  className?: string;
}

const DEFAULT_LABEL = "Descargar";

/** Etiqueta visible de cada formato en el menú de elección (R28). */
const ETIQUETA_FORMATO: Record<DescargaTipo, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
};

/** Formato aplicado cuando la configuración no declara ninguno (R28 → R2). */
const FORMATO_POR_DEFECTO: DescargaTipo = "xlsx";

/**
 * Accesores del ámbito «descarga de listado». A NIVEL DE MÓDULO, no inline: son dependencias
 * de los `useMemo` del hook, y una función creada en el render cambia de identidad cada vez.
 */
function claveDeDescarga(columna: DescargaColumna): string {
  return columna.clave;
}

/** R3: el nombre de cada opción ES el encabezado con el que la columna sale en el archivo. */
function etiquetaDeDescarga(columna: DescargaColumna): string {
  return columna.encabezado;
}

/**
 * R23/R27 — Mensajes ACCIONABLES: dicen qué hacer, no solo que no hubo archivo. El
 * mensaje del propio `obtenerFilas` (ya saneado por el consumidor) tiene prioridad.
 */
const MENSAJE_SIN_DATOS =
  "No hay datos que descargar con los filtros aplicados. Ajusta los filtros y vuelve a intentarlo.";
const MENSAJE_FALLO =
  "No se pudo generar el archivo. Vuelve a intentarlo; el listado no cambió.";

// --- Ficha 464: textos del selector con hoja de detalle (i18n-ready, sin dominio) ---------------

/** Nombre accesible del disparador: dice las DOS cosas que se eligen dentro. */
export const SELECTOR_DETALLE_DISPARADOR = "Elegir qué se descarga y sus columnas";
/** Encabezado del popup con detalle. */
const SELECTOR_DETALLE_TITULO = "Qué se descarga";
/** Rótulo (y nombre accesible) del grupo «qué se descarga». */
export const QUE_SE_DESCARGA_LEGEND = "Hojas del archivo";
/** Rótulo (y nombre accesible) del grupo «de qué hoja se eligen las columnas». */
export const COLUMNAS_DE_LA_HOJA_LEGEND = "Columnas de la hoja";
/** Rótulo de la lista de columnas, dentro del mismo popup. */
const COLUMNAS_DETALLE_LEGEND = "Columnas que salen en esa hoja";

const CON_DETALLE = "con-detalle";
const SIN_DETALLE = "sin-detalle";
const HOJA_PRINCIPAL = "principal";
const HOJA_DETALLE = "detalle";
type Hoja = typeof HOJA_PRINCIPAL | typeof HOJA_DETALLE;

/** Sin columnas fijas: lista estable (dependencia de `useMemo`). */
const SIN_FIJAS: readonly string[] = [];

/**
 * Ficha 468 (R51/R52) — las columnas que salen en el archivo: las del orden efectivo del ámbito que
 * estén marcadas O sean fijas. Sin fijas, exactamente las `visibles` del hook (el comportamiento de
 * siempre). Sin ámbito, `ordenadas` es el catálogo tal cual y todas salen.
 */
function columnasDelArchivo(
  ordenadas: readonly DescargaColumna[],
  visibles: DescargaColumna[],
  fijas: readonly string[],
): DescargaColumna[] {
  if (fijas.length === 0) return visibles;
  const marcadas = new Set(visibles.map(claveDeDescarga));
  return ordenadas.filter((c) => marcadas.has(c.clave) || fijas.includes(c.clave));
}

/** Ficha 468 (R23) — las negritas de la hoja principal, solo si las hay: sin ellas, el archivo de siempre. */
function destacadas(filas: readonly number[] | undefined): { filasDestacadas?: readonly number[] } {
  return filas === undefined || filas.length === 0 ? {} : { filasDestacadas: filas };
}

/** Ficha 464 — la hoja de detalle, ya resuelta, que acompaña a la principal en el archivo. */
function hojaDeDetalle(
  detalle: DataTableDescargaDetalle,
  columnasDetalle: DescargaColumna[],
  filas: DescargaHoja["filas"],
  filasDestacadas: readonly number[] | undefined,
): DescargaHoja {
  return {
    titulo: detalle.titulo,
    columnas: columnasDetalle,
    filas,
    ...(filasDestacadas === undefined || filasDestacadas.length === 0 ? {} : { filasDestacadas }),
  };
}

export function DescargarDatasetButton({
  titulo,
  columnas,
  obtenerFilas,
  formatos,
  ambitoColumnas,
  columnasFijas = SIN_FIJAS,
  detalle: detalleDeclarado,
  label,
  className,
}: DescargarDatasetButtonProps) {
  const toast = useToast();
  // Ficha 314 — ÚNICO punto donde la preferencia de columnas se aplica a un listado. Sin
  // ámbito la clave es `null`: el hook no lee, no escribe y devuelve las columnas declaradas
  // tal cual, así que las 24 tablas restantes no cambian ni una línea (R33).
  const claveColumnas =
    ambitoColumnas === undefined ? null : claveDeAmbitoDescarga(ambitoColumnas);
  const { visibles: marcadas, ordenadas } = usePreferenciaColumnas(
    claveColumnas,
    columnas,
    claveDeDescarga,
  );
  // Ficha 468 (R51/R52) — las fijas salen siempre; sin ámbito no hay selector y salen todas.
  const visibles = claveColumnas === null ? marcadas : columnasDelArchivo(ordenadas, marcadas, columnasFijas);
  // Ficha 464 — la hoja de detalle solo se ofrece con el ámbito de la principal: las dos hojas se
  // eligen en el mismo selector, y sin ámbito no habría dónde guardar la elección de la principal.
  const detalle = claveColumnas === null ? undefined : detalleDeclarado;
  const claveDetalle =
    detalle === undefined ? null : claveDeAmbitoDescarga(detalle.ambitoColumnas);
  const { visibles: marcadasDetalle, ordenadas: ordenadasDetalle } = usePreferenciaColumnas(
    claveDetalle,
    detalle?.columnas ?? SIN_COLUMNAS,
    claveDeDescarga,
  );
  const visiblesDetalle = columnasDelArchivo(ordenadasDetalle, marcadasDetalle, detalle?.columnasFijas ?? SIN_FIJAS);
  // R8 — arranca CON detalle y no se recuerda: es estado local, se pierde al desmontar.
  const [conDetalle, setConDetalle] = useState(true);
  const [hoja, setHoja] = useState<Hoja>(HOJA_PRINCIPAL);
  const descargaDetalle = detalle !== undefined && conDetalle;
  const [generando, setGenerando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Guard de CARRERA (R26): `generando` como estado no está actualizado hasta el
  // re-render, así que dos clicks seguidos podrían colarse. El ref sí lo está.
  const enVueloRef = useRef(false);
  const contenedorRef = useRef<HTMLDivElement | null>(null);

  // R12 — con la hoja de detalle el archivo es SIEMPRE Excel: un csv no tiene hojas.
  const disponibles: DescargaTipo[] = descargaDetalle
    ? [FORMATO_POR_DEFECTO]
    : formatos && formatos.length > 0
      ? formatos
      : [FORMATO_POR_DEFECTO];
  const eligeFormato = disponibles.length > 1;
  const nombreAccesible = `${label ?? DEFAULT_LABEL} ${titulo}`;

  // El menú se cierra al pulsar fuera; sin esto quedaría abierto tapando la tabla.
  useEffect(() => {
    if (!menuAbierto) return;
    function alPulsarFuera(evento: MouseEvent) {
      if (!contenedorRef.current?.contains(evento.target as Node)) {
        setMenuAbierto(false);
      }
    }
    document.addEventListener("mousedown", alPulsarFuera);
    return () => document.removeEventListener("mousedown", alPulsarFuera);
  }, [menuAbierto]);

  async function descargar(tipo: DescargaTipo) {
    if (enVueloRef.current) return; // R26: una sola descarga en vuelo
    enVueloRef.current = true;
    setGenerando(true);
    setMenuAbierto(false);
    try {
      // R41 — sin `detalle` declarado, la llamada de SIEMPRE: sin argumentos.
      const resultado =
        detalle === undefined
          ? await obtenerFilas()
          : await obtenerFilas({ conDetalle: descargaDetalle });
      if (resultado.status === "error") {
        // R27: el mensaje ya viene accionable y saneado desde el consumidor.
        toast.error(resultado.mensaje);
        return;
      }
      if (resultado.filas.length === 0) {
        toast.error(MENSAJE_SIN_DATOS); // R23: sin filas no se produce archivo
        return;
      }
      // R25 — Import DINÁMICO del generador común: mantiene `exceljs` fuera del
      // bundle inicial de todas las pantallas que montan un `DataTable`.
      const { construirDescarga } = await import("@/lib/utils/descarga-dataset");
      if (descargaDetalle && detalle !== undefined) {
        // Ficha 464 (R10/R36) — las dos hojas, de la MISMA respuesta. Sin filas de detalle no hay
        // archivo: una hoja vacía diría «ninguna orden» donde el consumidor no las leyó.
        if (resultado.filasDetalle === undefined) {
          throw new Error("faltan las filas de la hoja de detalle");
        }
        const archivo = await construirDescarga({
          tipo: FORMATO_POR_DEFECTO,
          titulo,
          columnas: visibles,
          filas: resultado.filas,
          ...destacadas(resultado.filasDestacadas),
          hojasAdicionales: [
            hojaDeDetalle(detalle, visiblesDetalle, resultado.filasDetalle, resultado.filasDestacadasDetalle),
          ],
        });
        descargarBlob(archivo.contenido, archivo.mime, archivo.nombreArchivo);
        return;
      }
      const archivo = await construirDescarga({
        tipo,
        titulo,
        // R4/R5/R20: las columnas MARCADAS y en el orden efectivo del ámbito. Sin ámbito son
        // las declaradas, en el orden del catálogo. El filtro va en las columnas y nunca en
        // los datos: las filas llegan enteras y el generador ignora las claves no declaradas.
        columnas: visibles,
        filas: resultado.filas,
        ...destacadas(resultado.filasDestacadas),
      });
      // R32: el archivo nace y muere en el navegador; ni subida ni almacenamiento.
      descargarBlob(archivo.contenido, archivo.mime, archivo.nombreArchivo);
    } catch {
      // R27 + docs/conventions: nada de catch vacío. Se avisa y NO se reintenta.
      toast.error(MENSAJE_FALLO);
    } finally {
      enVueloRef.current = false;
      setGenerando(false);
    }
  }

  function alPulsarDisparador() {
    if (eligeFormato) {
      setMenuAbierto((abierto) => !abierto);
      return;
    }
    // R28: con uno o ningún formato declarado se descarga directo, sin elección.
    void descargar(disponibles[0]);
  }

  return (
    <div
      ref={contenedorRef}
      className={cn("relative inline-flex items-center gap-1", className)}
      onKeyDown={(evento) => {
        if (evento.key === "Escape" && menuAbierto) setMenuAbierto(false);
      }}
    >
      <Button
        type="button"
        variant="brand-outline"
        onClick={alPulsarDisparador}
        disabled={generando}
        loading={generando}
        aria-label={nombreAccesible} // R30
        aria-haspopup={eligeFormato ? "menu" : undefined}
        aria-expanded={eligeFormato ? menuAbierto : undefined}
      >
        {generando ? null : <Download aria-hidden="true" />}
        {label ?? DEFAULT_LABEL}
      </Button>

      {/* R1 — control PARALELO al botón, no un paso de su camino: abrirlo no descarga, y el
          botón descarga en un click con lo ya guardado (R6). Solo se monta si hay ámbito. */}
      {claveColumnas !== null && detalle !== undefined ? (
        <SelectorConDetalle
          detalle={detalle}
          tituloPrincipal={titulo}
          clavePrincipal={claveColumnas}
          columnasPrincipal={columnas}
          fijasPrincipal={columnasFijas}
          conDetalle={conDetalle}
          onConDetalle={setConDetalle}
          hoja={hoja}
          onHoja={setHoja}
        />
      ) : claveColumnas !== null ? (
        <ColumnasPopover
          claveAlmacenamiento={claveColumnas}
          publicadas={columnas}
          claveDe={claveDeDescarga}
          etiquetaDe={etiquetaDeDescarga}
          titulo="Columnas del archivo"
          etiquetaDisparador="Elegir columnas de la descarga"
          fijas={columnasFijas}
        />
      ) : null}

      {eligeFormato && menuAbierto ? (
        <div
          role="menu"
          aria-label={nombreAccesible}
          className="absolute right-0 z-30 mt-1 min-w-40 rounded-lg border border-border bg-background p-1 shadow-md"
        >
          {disponibles.map((tipo) => (
            <button
              key={tipo}
              type="button"
              role="menuitem"
              onClick={() => void descargar(tipo)}
              className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
            >
              {ETIQUETA_FORMATO[tipo]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Catálogo vacío estable (dependencia de `useMemo` del hook): sin detalle no hay columnas que leer. */
const SIN_COLUMNAS: readonly DescargaColumna[] = [];

/**
 * Ficha 464 (R6/R8/R11) — el selector cuando hay hoja de detalle: arriba, qué hojas lleva el archivo;
 * si van las dos, de cuál se eligen las columnas; debajo, las columnas de ESA hoja con su ámbito.
 */
function SelectorConDetalle({
  detalle,
  tituloPrincipal,
  clavePrincipal,
  columnasPrincipal,
  fijasPrincipal,
  conDetalle,
  onConDetalle,
  hoja,
  onHoja,
}: {
  detalle: DataTableDescargaDetalle;
  tituloPrincipal: string;
  clavePrincipal: string;
  columnasPrincipal: DescargaColumna[];
  fijasPrincipal: readonly string[];
  conDetalle: boolean;
  onConDetalle: (v: boolean) => void;
  hoja: Hoja;
  onHoja: (h: Hoja) => void;
}) {
  const opcionesQue: readonly RadioGroupOption[] = [
    { value: SIN_DETALLE, label: detalle.etiquetaSinDetalle },
    { value: CON_DETALLE, label: detalle.etiquetaOpcion },
  ];
  // Cada hoja se nombra con SU nombre en el archivo: el control no conoce el dominio.
  const opcionesHoja: readonly RadioGroupOption[] = [
    { value: HOJA_PRINCIPAL, label: tituloPrincipal },
    { value: HOJA_DETALLE, label: detalle.titulo },
  ];
  // Sin detalle solo hay una hoja: la lista es la de la principal, se eligiera lo que se eligiera antes.
  const enDetalle = conDetalle && hoja === HOJA_DETALLE;
  const clave = enDetalle ? claveDeAmbitoDescarga(detalle.ambitoColumnas) : clavePrincipal;
  const publicadas = enDetalle ? detalle.columnas : columnasPrincipal;
  const fijas = enDetalle ? (detalle.columnasFijas ?? SIN_FIJAS) : fijasPrincipal;

  const encabezado = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{QUE_SE_DESCARGA_LEGEND}</span>
        <RadioGroup
          value={conDetalle ? CON_DETALLE : SIN_DETALLE}
          onValueChange={(v) => onConDetalle(v === CON_DETALLE)}
          options={opcionesQue}
          aria-label={QUE_SE_DESCARGA_LEGEND}
        />
      </div>
      {conDetalle ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{COLUMNAS_DE_LA_HOJA_LEGEND}</span>
          <RadioGroup
            value={hoja}
            onValueChange={(v) => onHoja(v === HOJA_DETALLE ? HOJA_DETALLE : HOJA_PRINCIPAL)}
            options={opcionesHoja}
            aria-label={COLUMNAS_DE_LA_HOJA_LEGEND}
          />
        </div>
      ) : null}
      <span className="text-sm font-medium">{COLUMNAS_DETALLE_LEGEND}</span>
    </div>
  );

  return (
    <ColumnasPopover
      claveAlmacenamiento={clave}
      publicadas={publicadas}
      claveDe={claveDeDescarga}
      etiquetaDe={etiquetaDeDescarga}
      titulo={SELECTOR_DETALLE_TITULO}
      etiquetaDisparador={SELECTOR_DETALLE_DISPARADOR}
      encabezado={encabezado}
      fijas={fijas}
    />
  );
}
