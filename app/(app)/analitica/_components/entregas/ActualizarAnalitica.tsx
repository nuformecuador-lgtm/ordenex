"use client";

// EL BOTÓN «ACTUALIZAR» DE LA ANALÍTICA, con el sello de frescura al lado (pedido humano
// 2026-08-19).
//
// Hace DOS cosas, en este orden, y las dos hacen falta:
//
//   1. `refrescarCacheAnalitica()` — invalida los tags de la cache de servidor. Sin este paso
//      el botón sería decorativo dentro de la ventana del TTL: las seis lecturas de entregas
//      se sirven de una cache de 15 minutos y el dominio operativa de una de 1 hora, así que
//      volver a pedirlas devolvería el MISMO valor, con el mismo sello.
//   2. `mutate` por PREFIJO de clave — vuelve a pedir todo lo que cuelga de `CLAVE_TABLERO`:
//      las seis gráficas de entregas y los paneles operativos. Ahora sí fallan en cache, tocan
//      la base y reescriben la entrada con un `lastSync` nuevo.
//
// Invertir el orden dejaría lo peor de los dos mundos: se recargaría la pantalla con lo viejo y
// se tiraría la cache justo después, para nadie.
//
// ─── DE DÓNDE SALE EL SELLO QUE SE PINTA ────────────────────────────────────────────────────
//
// De `ConteoEntregasDTO.lastSync`, leyendo la MISMA entrada SWR que el anillo de la sección
// (`claveConteoEntregas`). No del reloj del navegador y no del instante del clic: el sello dice
// cuándo se LEYERON las cifras de la base, que es lo único que responde a «¿esto es de ahora?».
// Pintar la hora del render sobre un acierto de cache haría que la pantalla jurara ser de este
// segundo llevando hasta un cuarto de hora de retraso — que es exactamente el error que el
// servicio evita sellando dentro del productor.
//
// Compartir clave con el anillo tiene además una consecuencia buena y una condición: SWR sirve
// una sola petición para los dos suscriptores (comparte por igualdad de clave), y por eso la
// clave se importa en vez de escribirse aquí.
//
// Sin sello todavía (primera carga, o una respuesta que no es `ok`) el hueco NO se rellena con
// una hora inventada ni se deja en blanco: se dice que no se sabe. Un rótulo vacío se lee como
// «se está actualizando solo».

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { Button } from "@/components/ui/button";
import { refrescarCacheAnalitica } from "@/lib/actions/analitica-refrescar";
import { monedaConfig } from "@/lib/config/moneda";

import { CLAVE_TABLERO } from "../operativo/PanelOperativo";
import { TEXTO_ERROR_PANEL, TEXTO_PROHIBIDO, TEXTO_SESION_NO_VALIDA } from "../operativo/textos";

import { claveConteoEntregas, consultarConteoEntregasSwr } from "./conteo-entregas-swr";

export const ETIQUETA_ACTUALIZAR = "Actualizar";

export const DESCRIPCION_ACTUALIZAR =
  "Descarta las cifras guardadas y vuelve a leerlas de la base, con el filtro que ya está puesto.";

/** Prefijo del sello. Se escribe una vez y lo comparten el rótulo y su nombre accesible. */
const PREFIJO_SELLO = "Actualizado";

/** Lo que se dice cuando todavía no hay ninguna lectura de la que informar. */
const SELLO_DESCONOCIDO = `${PREFIJO_SELLO} —`;

/**
 * El sello legible de un `lastSync` ISO-8601.
 *
 * ─── LA ZONA HORARIA ES LA DEL SISTEMA (pedido humano 2026-08-19) ───────────────────────────
 *
 * **NO se declara `timeZone`**, y esa ausencia es la decisión: sin esa opción `Intl` usa la
 * zona del entorno donde corre —la del reloj que el usuario tiene delante—, que es con la que
 * va a comparar el sello. Este componente nació forzando `America/Costa_Rica`, y eso hacía que
 * quien tuviera el equipo en otra zona leyera una hora que no coincidía con su propio reloj: el
 * mismo instante rotulado con una hora ajena se lee como un dato viejo, o como uno del futuro.
 *
 * Lo que se pierde y se asume: dos personas en zonas distintas ven el MISMO instante con dos
 * horas distintas. Es el trato habitual de un sello de frescura —cada uno lo compara con su
 * reloj— y es lo que se pidió. Si algún día hace falta anclarlo a la zona de la operación, el
 * sitio es `lib/config/`, donde ya vive `RASTREO_PUBLICO_ZONA_HORARIA`, y no un literal aquí.
 *
 * El LOCALE tampoco es un literal: sale de `monedaConfig.locale` (`MONEDA_LOCALE`), que es de
 * donde lo toma el resto del formateo del repo —`components/private/analytics/formato.ts` lo
 * hace igual, y su cabecera lo dice con todas las letras: «ni un literal de idioma»—.
 *
 * Sólo la hora y el minuto; el día lo pone el `title`, porque un sello a segundos invita a leer
 * una precisión que una cache de 15 minutos no tiene.
 *
 * Función PURA y exportada: el formato es lo que se comprueba en test, sin montar nada.
 */
export function textoSello(lastSync: string | null): string {
  if (lastSync === null) return SELLO_DESCONOCIDO;
  const instante = new Date(lastSync);
  if (Number.isNaN(instante.getTime())) return SELLO_DESCONOCIDO;
  const hora = new Intl.DateTimeFormat(monedaConfig.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instante);
  return `${PREFIJO_SELLO} ${hora}`;
}

/**
 * El día y la hora completos, para el `title`: lo que el sello corto no cabe a decir.
 *
 * Misma zona y mismo locale que el sello corto —los del sistema— por la razón evidente: dos
 * horas distintas para el mismo instante, una en el rótulo y otra al pasar el ratón, es peor
 * que no tener el `title`.
 */
export function textoSelloCompleto(lastSync: string | null): string | undefined {
  if (lastSync === null) return undefined;
  const instante = new Date(lastSync);
  if (Number.isNaN(instante.getTime())) return undefined;
  return new Intl.DateTimeFormat(monedaConfig.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instante);
}

export function ActualizarAnalitica() {
  // El filtro lo publica la barra de entregas, que está montada justo al lado. Entra en la
  // clave: el sello que se pinta es el de la consulta que hay en pantalla, no el de otra.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data } = useSWR(
    claveConteoEntregas(filtroSerializado),
    () => consultarConteoEntregasSwr(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );
  const lastSync = data?.status === "ok" ? data.datos.lastSync : null;

  const { mutate } = useSWRConfig();
  const [refrescando, setRefrescando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const actualizar = useCallback(async () => {
    setRefrescando(true);
    setFallo(null);
    try {
      const res = await refrescarCacheAnalitica();
      if (res.status === "unauthenticated") {
        setFallo(TEXTO_SESION_NO_VALIDA);
        return;
      }
      if (res.status === "forbidden") {
        setFallo(TEXTO_PROHIBIDO);
        return;
      }
      // Se espera al `mutate` DENTRO del `try`: mientras las gráficas vuelven a consultar, el
      // botón sigue deshabilitado. Soltarlo antes invitaría a un segundo clic que tiraría la
      // cache otra vez a mitad del recomputo del primero.
      await mutate((clave) => Array.isArray(clave) && clave[0] === CLAVE_TABLERO);
    } catch {
      // Un fallo aquí no puede quedarse callado: el usuario acaba de pedir datos frescos y lo
      // que hay en pantalla siguen siendo los viejos.
      setFallo(TEXTO_ERROR_PANEL);
    } finally {
      setRefrescando(false);
    }
  }, [mutate]);

  return (
    // `h-8` en el grupo entero: es el alto de los controles de `BuscadorFiltros`
    // (`ALTO_CONTROL`), y es lo que pone este botón en la MISMA línea que el campo y el
    // selector de filtros de al lado en vez de un pelo por encima. Por eso tampoco lleva
    // `size="sm"` (h-7), que era justo el desnivel que se veía.
    <div className="flex h-8 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => void actualizar()}
        disabled={refrescando}
        title={DESCRIPCION_ACTUALIZAR}
      >
        {/* `animate-spin` sólo mientras dura: es la única señal de que el clic hizo algo, porque
            las cifras pueden volver idénticas si nadie tocó nada entre medias. */}
        <RefreshCw className={`h-4 w-4 ${refrescando ? "animate-spin" : ""}`} aria-hidden />
        {ETIQUETA_ACTUALIZAR}
      </Button>
      {/* AL LADO DEL BOTÓN y no debajo: el sello es lo que da sentido al botón —dice desde
          cuándo hace falta pulsarlo—, y separarlos deja un botón sin motivo y una hora sin
          dueño. `role="status"` para que un lector de pantalla anuncie el sello nuevo cuando
          llegue, sin robar el foco. */}
      <span
        role="status"
        className="text-xs whitespace-nowrap text-muted-foreground"
        title={textoSelloCompleto(lastSync)}
      >
        {fallo ?? textoSello(lastSync)}
      </span>
    </div>
  );
}
