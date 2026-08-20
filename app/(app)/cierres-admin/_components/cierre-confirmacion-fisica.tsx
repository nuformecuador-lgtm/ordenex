"use client";

import { PackageCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import {
  RESULTADOS_QUE_VUELVEN,
  vuelveABodega,
} from "@/lib/types/gestion-retorno";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

import { RESULTADO_LABEL, RESULTADO_FILA_LABEL } from "./cierre-labels";

// Feature 238 (T4.2-T4.5, design §5.2/§5.3) — el CUERPO de la ventana de confirmación física:
// lo que bodega ve mientras confirma, guía a guía, que tiene delante cada paquete que vuelve.
//
// Vive fuera de `CierresAdminModule` por el mismo motivo por el que salieron `cierre-factura` y
// `cierre-detalle-shared`: el módulo ya orquesta cuatro modales, y aquí hay ~150 líneas de
// presentación que no deciden nada. **El estado no vive acá**: lo confirmado, el aviso de la
// última lectura y los errores del servidor son del módulo, porque tienen que sobrevivir a
// cerrar y reabrir la ventana (design §5.4) y morir con `cerrarDetalle`. Este componente es
// una función de sus props.
//
// Lo que NO se reinventa: la captura es `EscanerGuiaCard` con sus dos caminos (cámara y número
// tecleado) y el parseo del QR es `extractNumGuiaFromScan`, los mismos que usan las otras seis
// superficies de escaneo. Y **no** se usa `EscanerModal`: ese envoltorio trae su propio botón
// disparador y su propio diálogo, y esto ya vive dentro de uno.

/** Cómo llegó el texto que hay que interpretar: la cámara entrega una URL, el teclado un número. */
export type MedioDeCaptura = "camara" | "manual";

// --- Textos de la ventana (i18n-ready, separados de la lógica, como el resto del módulo) ---

export const CONFIRMACION_TITULO = "Confirmar los paquetes que vuelven";
export const CONFIRMACION_DETALLE =
  "Antes de aprobar, tené delante cada paquete que vuelve a bodega y confirmá su guía: escaneá el código o escribí el número.";
/** Queda un paso más (los montos de los incidentes), así que el botón no promete aprobar. */
export const CONFIRMACION_CONTINUAR = "Continuar";
export const CONFIRMACION_APROBAR = "Confirmar y aprobar";

const ESCANER_TITULO = "Confirmar paquete recibido";
const ESCANER_DESCRIPCION = "Escaneá el código de la guía o escribí su número";
const ESCANER_BOTON = "Confirmar";
const ESCANER_ERROR_CAMARA = "No se pudo abrir la cámara.";

const FILA_PENDIENTE = "Pendiente";
const FILA_CONFIRMADA = "Confirmada";
/**
 * R13, la mitad del cliente. La orden llegó a reparto sin número de guía: no hay nada que
 * escanear, así que ese cierre **no se va a poder aprobar** y bodega tiene que saberlo ANTES de
 * escanear las otras trece. El servidor bloquea igual y con su propio mensaje; esto sólo evita
 * el bloqueo mudo, que es lo que se lee como una app rota.
 *
 * El texto es propio y NO se importa del servicio: los seis mensajes de `CierresAdminService`
 * son constantes de módulo sin exportar, y traerse un módulo de servicio a un componente de
 * cliente arrastraría el servidor entero. Dicen lo mismo con palabras distintas a propósito —
 * si algún día divergieran, la que manda es la del servidor, que es la que decide.
 */
const FILA_SIN_GUIA =
  "Sin número de guía: no se puede confirmar. Avisá a un administrador.";

/**
 * Dos filas, UN solo bulto. Se dice en la fila porque es lo que hace legible lo que si no parece
 * un error: al leer esa guía, dos filas cambian a «Confirmada» de golpe y el contador —que va en
 * paquetes— avanza sólo uno. Sin esta línea, quien escanea ve la misma guía repetida y busca el
 * segundo paquete que no existe, o cree que la app marcó de más.
 *
 * Siempre en plural («N filas»): `cuantasFilas` es 2 o más por construcción, así que no hay
 * concordancia que resolver.
 */
export function filaMismoPaquete(cuantasFilas: number): string {
  return `Este paquete aparece en ${cuantasFilas} filas de esta lista: una sola lectura las confirma todas.`;
}

// --- Los cuatro desenlaces de una guía leída (R29-R32) ---
// Son cuatro mensajes DISTINTOS a propósito: son cuatro correcciones distintas para quien está
// en el mostrador con el paquete en la mano. «No es de este cierre» manda a buscar en otra pila;
// «no vuelve a bodega» dice que ese paquete no existe o se quedó con el cliente; «ya está
// confirmada» evita que se escanee dos veces creyendo que la primera no entró.

/** R29 — lo leído no se puede interpretar como número de guía. */
const LECTURA_ILEGIBLE =
  "No se pudo leer un número de guía en ese código. Escaneá de nuevo o escribí el número.";
/** R30 — la guía no es de ninguna gestión de este cierre. */
const LECTURA_AJENA = "Esa guía no pertenece a este cierre.";
/** R32 — ya se confirmó en esta sesión. */
const LECTURA_YA_CONFIRMADA =
  "Esa guía ya está confirmada. No se cuenta dos veces.";

/** R31 — es de este cierre, pero ese paquete no vuelve a bodega. Se nombra POR QUÉ no vuelve. */
function lecturaNoVuelve(resultado: CierreResultado): string {
  return `Esa guía es de este cierre, pero ese paquete no vuelve a bodega. Resultado: ${RESULTADO_FILA_LABEL[resultado]}.`;
}

/**
 * R27 — el motivo del bloqueo, CON PALABRAS. Y nombra la salida: si un paquete no llegó, la
 * puerta es rechazar el cierre (D2, firmada: no hay «aprobar de todas formas»). Sin nombrarla,
 * quien está bloqueado busca una puerta trasera que no existe.
 */
export function textoFaltan(faltan: number): string {
  return faltan === 1
    ? "Falta 1 paquete por confirmar. Si no llegó, rechazá el cierre indicando cuál falta."
    : `Faltan ${faltan} paquetes por confirmar. Si alguno no llegó, rechazá el cierre indicando cuáles faltan.`;
}

/**
 * El progreso, siempre visible: con catorce filas, «cuántas van» no puede vivir al final.
 *
 * La frase pone el número DESPUÉS del sustantivo («1 de 3») y no antes («Confirmados 0 de 1
 * paquetes») para que no haya que concordar en número: con un solo paquete, la segunda forma
 * escribe «de 1 paquetes».
 */
export function textoProgreso(confirmadas: number, total: number): string {
  return `Paquetes confirmados: ${confirmadas} de ${total}.`;
}

/**
 * Ya están todos los paquetes delante. Lo que viene DEPENDE del cierre, y decirlo mal es la
 * clase de mentira que ninguna suite mira: con incidentes todavía queda teclear los montos
 * (R37), así que anunciar «ya se puede aprobar» junto a un botón que dice «Continuar» deja a
 * bodega buscando el botón de aprobar que no existe.
 */
export function textoCompleta(hayIncidentes: boolean): string {
  return hayIncidentes
    ? "Están todos. Queda indicar los montos de los incidentes."
    : "Están todos. Ya se puede aprobar el cierre.";
}

/**
 * R34 — los incidentes, NOMBRADOS como excluidos y con su razón. No es un detalle de cortesía:
 * medido el 2026-08-19, hay incidentes en 2 de 12 cierres y conviven con retornables, así que
 * esta línea se ve de verdad. Sin ella, bodega cuenta los paquetes del cierre, le salen más que
 * los de la lista y busca el que «falta».
 */
export function textoIncidentesExcluidos(cuantos: number): string {
  return cuantos === 1
    ? "1 incidente de este cierre no se escanea: ese paquete no vuelve a bodega, se indemniza."
    : `${cuantos} incidentes de este cierre no se escanean: esos paquetes no vuelven a bodega, se indemnizan.`;
}

/**
 * R2 — el CONJUNTO ESPERADO tal como lo ve la pantalla: las gestiones del cierre cuyo paquete
 * vuelve a bodega, sacadas del MISMO detalle que ya se pidió al servidor y filtradas por el
 * PUNTO ÚNICO (`RESULTADOS_QUE_VUELVEN`), no por una lista escrita acá.
 *
 * Que salga del detalle ya cargado y no de una consulta aparte es lo que hace cierto que el
 * conjunto que la ventana pide confirmar sea exactamente el que el servicio exige cubrir. Es la
 * propiedad que la 158 declaró para los incidentes, aplicada al conjunto hermano.
 */
export function retornablesDelCierre(grupos: CierreGrupos): CierreDetalleGestion[] {
  return RESULTADOS_QUE_VUELVEN.flatMap((resultado) => grupos[resultado]);
}

/**
 * TODAS las gestiones del cierre, de los cinco resultados. Hace falta para poder distinguir
 * R30 («no es de este cierre») de R31 («es de este cierre y no vuelve»): con sólo las
 * retornables delante, las dos lecturas serían indistinguibles.
 */
export function gestionesDelCierre(grupos: CierreGrupos): CierreDetalleGestion[] {
  return Object.values(grupos).flat();
}

/**
 * Lo que produce interpretar una lectura: o marca filas, o dice qué pasó. Nunca las dos.
 *
 * `gestionIds` es una LISTA y no una gestión suelta a propósito: una guía puede tener **más de
 * una fila pendiente** en el mismo cierre (dos gestiones vivas de la misma orden), y hay UN solo
 * paquete físico detrás. Una lectura = «tengo este paquete delante» = todas sus filas cubiertas.
 * Con una sola gestión por lectura, la segunda fila no se podía confirmar nunca (ver
 * `interpretarLectura`).
 */
export type LecturaInterpretada =
  | { tipo: "confirma"; gestionIds: readonly string[]; numGuia: number }
  | { tipo: "aviso"; mensaje: string };

/**
 * R29-R32 — de un texto leído a uno de los cuatro desenlaces. **Función pura**: no toca estado,
 * no llama a ninguna Server Action y no sabe pintar. Toda la resolución `numGuia -> gestión` se
 * hace en el cliente contra el detalle YA cargado, que es el mismo conjunto que el servidor
 * exige cubrir (design §5.1): no hay una segunda consulta que pueda decir otra cosa.
 *
 * Se buscan TODAS las gestiones del cierre y no sólo las que vuelven, porque distinguir «no es
 * de este cierre» de «es de este cierre y no vuelve» son dos correcciones distintas (R30 vs R31)
 * y sólo se pueden distinguir mirando las cinco secciones.
 *
 * **Se buscan TODAS las filas de esa guía, no la primera.** Un cierre puede traer dos gestiones
 * vivas de la MISMA orden y, por tanto, con la misma guía: medido contra producción el
 * 2026-08-19, 1 de 48 pares (cierre, orden) vivos está en ese caso, y es justo del tipo que
 * bloquea. Con `find` pasaba esto: la primera lectura confirmaba la primera fila, la segunda
 * lectura volvía a caer en esa misma fila y respondía «ya está confirmada», y la segunda fila se
 * quedaba `Pendiente` PARA SIEMPRE — el contador clavado en `N-1 de N`, el botón apagado y el
 * cierre imposible de aprobar por ninguna vía. El servidor no tiene ese candado: dedupe por
 * `gestionId` (no por guía) y compara la guía contra la de CADA gestión, así que dos entradas
 * con la misma `numGuia` y distinto `gestionId` le valen.
 */
export function interpretarLectura(
  texto: string,
  medio: MedioDeCaptura,
  gestionesDelCierre: readonly CierreDetalleGestion[],
  yaConfirmadas: Readonly<Record<string, number>>,
): LecturaInterpretada {
  // La cámara entrega la URL del paquete (`<origin>/paquete/<numGuia>`) y hay que extraer el
  // número; lo tecleado ES el número. Es la ÚNICA diferencia entre los dos caminos, igual que
  // en `RecogerPaqueteCard`: de aquí en adelante los dos recorren exactamente el mismo camino.
  const numGuia =
    medio === "camara"
      ? extractNumGuiaFromScan(texto)
      : /^\d+$/.test(texto.trim())
        ? Number(texto.trim())
        : null;
  if (numGuia === null || !Number.isSafeInteger(numGuia) || numGuia <= 0) {
    return { tipo: "aviso", mensaje: LECTURA_ILEGIBLE }; // R29
  }

  // Las gestiones sin guía (`numGuia === null`) no casan nunca: `numGuia` ya es un número acá.
  const conEsaGuia = gestionesDelCierre.filter((g) => g.numGuia === numGuia);
  if (conEsaGuia.length === 0) return { tipo: "aviso", mensaje: LECTURA_AJENA }; // R30

  // R31: `vuelveABodega` es el PUNTO ÚNICO. La pantalla no decide por su cuenta qué vuelve; si
  // lo decidiera, podría pedir confirmar un conjunto distinto del que el servidor exige y el
  // botón se quedaría bloqueado sin explicación posible.
  //
  // El aviso sale sólo si NINGUNA de las filas de esa guía vuelve. Basta con que una vuelva para
  // que el paquete esté delante y haya algo que confirmar: mirar sólo la primera convertía una
  // `entregada` que comparte guía con una `devuelta` en el mismo bloqueo mudo de antes.
  const queVuelven = conEsaGuia.filter((g) => vuelveABodega(g.resultado));
  if (queVuelven.length === 0) {
    // Se nombra el resultado de la primera: son todas del mismo paquete, y lo que corrige a
    // quien está en el mostrador es SABER que ese bulto no se escanea, no cuál de las filas.
    return { tipo: "aviso", mensaje: lecturaNoVuelve(conEsaGuia[0].resultado) };
  }

  const pendientes = queVuelven.filter(
    (g) => yaConfirmadas[g.gestionId] === undefined,
  );
  // R32, intacto y con su motivo: avisa cuando YA NO QUEDA NADA que cubrir con esa guía, que es
  // el caso en que la segunda lectura del mismo bulto no cuenta. Mientras quede una fila
  // pendiente sí hay algo que confirmar, y avisar ahí era el defecto.
  if (pendientes.length === 0) {
    return { tipo: "aviso", mensaje: LECTURA_YA_CONFIRMADA };
  }
  return { tipo: "confirma", gestionIds: pendientes.map((g) => g.gestionId), numGuia };
}

/**
 * La CLAVE del paquete FÍSICO de una fila. Dos gestiones vivas de la misma orden llegan con la
 * misma guía y son **un solo bulto** en el estante: cuentan una vez.
 *
 * Sin guía no hay forma de saber si dos filas son el mismo bulto, así que cada una cuenta por su
 * cuenta. No es un detalle: colapsarlas rebajaría el total y, con él, el número de paquetes que
 * bodega tiene que poner delante — y esas filas además no se pueden confirmar nunca (R13), así
 * que el bloqueo tiene que seguir contándolas.
 */
function clavePaquete(g: CierreDetalleGestion): string {
  return g.numGuia === null ? `sin-guia:${g.gestionId}` : `guia:${g.numGuia}`;
}

/** Las filas del conjunto esperado, agrupadas por paquete físico (una guía, un bulto). */
export function agruparPorPaquete(
  retornables: readonly CierreDetalleGestion[],
): CierreDetalleGestion[][] {
  const porClave = new Map<string, CierreDetalleGestion[]>();
  for (const g of retornables) {
    const grupo = porClave.get(clavePaquete(g));
    if (grupo === undefined) porClave.set(clavePaquete(g), [g]);
    else grupo.push(g);
  }
  return [...porClave.values()];
}

/**
 * R27 — el progreso EN PAQUETES, que es lo que el rótulo dice y lo que bodega cuenta en el
 * estante. **No en filas**: en el cierre medido el 2026-08-19 eran doce filas para once bultos,
 * así que «Paquetes confirmados: X de 12» ya mentía antes de este arreglo; y desde el arreglo,
 * contar filas haría además que una sola lectura moviera el contador de dos en dos, que a los
 * ojos de quien escanea es un error de la app.
 *
 * `faltan` es el MISMO candado de antes: un paquete cuenta como hecho sólo si TODAS sus filas
 * están confirmadas, y una lectura confirma todas las pendientes de esa guía a la vez, así que
 * «faltan 0 paquetes» y «no queda ninguna fila pendiente» son la misma condición. Contarlo en
 * paquetes cambia el número que se DICE, no el que bloquea.
 */
export function progresoDePaquetes(
  retornables: readonly CierreDetalleGestion[],
  confirmadas: Readonly<Record<string, number>>,
): { total: number; hechas: number; faltan: number } {
  const paquetes = agruparPorPaquete(retornables);
  const hechas = paquetes.filter((filas) =>
    filas.every((g) => confirmadas[g.gestionId] !== undefined),
  ).length;
  return { total: paquetes.length, hechas, faltan: paquetes.length - hechas };
}

/**
 * R2/R33 — las gestiones que vuelven, AGRUPADAS por resultado y en el orden que declara el punto
 * único. El orden no se elige acá: se deriva de `RESULTADOS_QUE_VUELVEN`, para que añadir un
 * resultado retornable al `Record` lo haga aparecer en la ventana sin tocar este archivo.
 */
export function agruparRetornables(
  retornables: readonly CierreDetalleGestion[],
): { resultado: CierreResultado; gestiones: CierreDetalleGestion[] }[] {
  return RESULTADOS_QUE_VUELVEN.map((resultado) => ({
    resultado,
    gestiones: retornables.filter((g) => g.resultado === resultado),
  })).filter((grupo) => grupo.gestiones.length > 0);
}

export interface ConfirmacionFisicaCuerpoProps {
  /** El conjunto esperado: las gestiones del cierre cuyo paquete vuelve a bodega. */
  retornables: readonly CierreDetalleGestion[];
  /** R34: las `incidente` del mismo cierre, para nombrarlas como excluidas. */
  incidentes: readonly CierreDetalleGestion[];
  /** `gestionId -> numGuia leído`. Lo confirmado en esta sesión. */
  confirmadas: Readonly<Record<string, number>>;
  /** Errores del servidor por gestión (`fieldErrors`), pintados en su fila. */
  errores: Readonly<Record<string, string>>;
  /** R29-R32: qué pasó con la última lectura; `null` si no hay nada que decir. */
  aviso: string | null;
  /** Confirmación persistente del último acierto, bajo el formulario. */
  ultimaGuiaConfirmada: number | null;
  /** Interpreta y aplica una lectura. Devuelve `true` si marcó una fila (limpia el campo). */
  onLectura: (texto: string, medio: MedioDeCaptura) => boolean;
}

export function ConfirmacionFisicaCuerpo({
  retornables,
  incidentes,
  confirmadas,
  errores,
  aviso,
  ultimaGuiaConfirmada,
  onLectura,
}: Readonly<ConfirmacionFisicaCuerpoProps>) {
  // El rótulo dice «paquetes», así que se cuentan PAQUETES: una guía repetida en dos filas es un
  // solo bulto en el estante (ver `progresoDePaquetes`).
  const { total, hechas, faltan } = progresoDePaquetes(retornables, confirmadas);
  // Cuántas filas comparten bulto con otra, para poder decirlo en la fila.
  const filasPorPaquete = new Map<string, number>(
    agruparPorPaquete(retornables).map((filas) => [
      clavePaquete(filas[0]),
      filas.length,
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- La barra de estado ----------
          VA ARRIBA Y PEGADA, y esa es la decisión de diseño de esta ventana. Medido contra
          producción el 2026-08-19: el techo de un cierre son CATORCE guías (media 2,7). Con
          catorce filas y bodega escaneando de pie, un progreso al final de la lista no existe:
          hay que soltar el paquete, desplazar y volver. Aquí hay dos candados para que no pase:
          (1) `sticky top-0` dentro del cuerpo del modal, que es el contenedor que desplaza; y
          (2) la LISTA tiene su propio desplazamiento acotado más abajo, así que en el caso
          normal el cuerpo del modal no desplaza en absoluto y esta barra ni se mueve.

          No va en la `description` del Modal —que también queda fija— porque eso es
          `Dialog.Description`: se anuncia UNA vez al abrir y un contador que cambia con cada
          escaneo no se volvería a anunciar. Acá es una región viva (`role="status"`). */}
      <div className="sticky top-0 z-10 flex flex-col gap-1.5 bg-background pb-3">
        <p role="status" className="text-sm font-medium">
          {textoProgreso(hechas, total)}
        </p>
        {/* R27: el motivo del bloqueo con TEXTO, nunca sólo un botón apagado. */}
        {faltan > 0 ? (
          <p role="note" className="text-sm text-muted-foreground">
            {textoFaltan(faltan)}
          </p>
        ) : (
          <p role="note" className="text-sm font-medium text-success-strong">
            {textoCompleta(incidentes.length > 0)}
          </p>
        )}
        {/* R29-R32: qué pasó con la última lectura. Persistente y no un toast: el toast se va
            solo y quien está escaneando una tanda seguida necesita seguir viéndolo. */}
        {aviso ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {aviso}
          </p>
        ) : null}
      </div>

      {/* ---------- R34: los incidentes excluidos, nombrados ---------- */}
      {incidentes.length > 0 ? (
        <section
          aria-label="Incidentes excluidos de la confirmación"
          className="rounded-lg border border-info/40 bg-info-soft px-3 py-2 dark:bg-info/15"
        >
          <p className="text-sm font-medium text-info-strong">
            {textoIncidentesExcluidos(incidentes.length)}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {incidentes.map((g) => (
              <li key={g.gestionId} className="text-xs text-info-strong">
                {`Nº Guía ${g.numGuia ?? "—"} · ${g.numRemision} · ${g.destinatario}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* La tarjeta de captura, con sus DOS caminos (R28). `max-w-none` porque la tarjeta nace
            con el ancho de una pantalla de teléfono y acá vive en una columna del modal. */}
        <EscanerGuiaCard
          className="max-w-none"
          ariaLabel="Confirmar por número de guía o escaneo"
          titulo={ESCANER_TITULO}
          descripcion={ESCANER_DESCRIPCION}
          icono={PackageCheck}
          onDecoded={(texto) => {
            onLectura(texto, "camara");
          }}
          mensajeErrorCamara={ESCANER_ERROR_CAMARA}
          manual={{
            onSubmit: (valor) => onLectura(valor, "manual"),
            submitLabel: ESCANER_BOTON,
          }}
          exito={
            ultimaGuiaConfirmada === null ? undefined : (
              <>
                Guía{" "}
                <span className="font-semibold">{ultimaGuiaConfirmada}</span>{" "}
                confirmada.
              </>
            )
          }
        />

        {/* ---------- La lista del conjunto esperado (R33) ----------
            Con su PROPIO desplazamiento acotado: catorce filas caben en un modal alto, pero
            desplazar la lista entera arrastraría también la barra de estado y la tarjeta de
            captura, que son justo lo que hay que tener a la vista mientras se escanea. */}
        <div className="max-h-[45vh] overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            {agruparRetornables(retornables).map(({ resultado, gestiones }) => (
              <section key={resultado} aria-label={RESULTADO_LABEL[resultado]}>
                <h3 className="mb-1.5 text-sm font-semibold">
                  {`${RESULTADO_LABEL[resultado]} (${gestiones.length})`}
                </h3>
                <ul className="flex flex-col gap-2">
                  {gestiones.map((g) => {
                    const confirmada = confirmadas[g.gestionId] !== undefined;
                    const error = errores[g.gestionId];
                    const filasDelPaquete = filasPorPaquete.get(clavePaquete(g)) ?? 1;
                    return (
                      <li
                        key={g.gestionId}
                        data-gestion={g.gestionId}
                        className="flex flex-col gap-1 rounded-lg border border-border p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {`Nº Guía ${g.numGuia ?? "—"} · ${g.numRemision}`}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline">
                              {RESULTADO_FILA_LABEL[g.resultado]}
                            </Badge>
                            <Badge variant={confirmada ? "success" : "warning"}>
                              {confirmada ? FILA_CONFIRMADA : FILA_PENDIENTE}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {`${g.destinatario} · ${g.tiendaNombre}`}
                        </p>
                        {g.numGuia === null ? (
                          <p role="alert" className="text-sm text-destructive">
                            {FILA_SIN_GUIA}
                          </p>
                        ) : null}
                        {/* Dos gestiones vivas de la misma orden = una guía, un bulto. Se nombra
                            para que ver la misma guía dos veces no se lea como un error. Sin
                            `role`: es contenido de la fila, no un aviso aparte — el `role="note"`
                            de la barra de estado es el del BLOQUEO (R27) y tiene que seguir
                            siendo el único, o dejaría de poder señalarse. */}
                        {filasDelPaquete > 1 ? (
                          <p className="text-xs text-muted-foreground">
                            {filaMismoPaquete(filasDelPaquete)}
                          </p>
                        ) : null}
                        {/* T4.7: el error del servidor de ESA gestión, en SU fila. Espejo de lo
                            que la 158 hace con los montos. */}
                        {error ? (
                          <p
                            id={`confirmacion-${g.gestionId}-error`}
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {error}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
