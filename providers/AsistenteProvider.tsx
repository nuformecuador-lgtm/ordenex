"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { partirNdjson, type DocumentoAnunciado } from "@/lib/asistente/protocolo";
import type { ImagenAdjunta } from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 (T14 — R30, y el soporte de R22/R26/R27) — EL ESTADO DEL ASISTENTE, SÓLO EN EL
 * CLIENTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * R30 — LA CONVERSACIÓN VIVE AQUÍ Y EN NINGÚN OTRO SITIO, Y ESO ES DELIBERADO
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Los turnos son `useState` de este proveedor. **Recargar la pestaña los pierde**, y ésa es la
 * funcionalidad, no una carencia: lo que la gente escribe en un asistente de ayuda lleva, tarde o
 * temprano, el nombre de un cliente y un número de guía. Mientras eso no se escriba en ninguna
 * parte no hay retención que decidir ni dato que custodiar.
 *
 * ⚠️ POR ESO AQUÍ NO HAY `localStorage`, NI `sessionStorage`, NI COOKIE, NI `indexedDB`. No es
 * que «todavía no se haya implementado la persistencia»: es que persistir sería romper R30. La
 * guardia `asistente-panel-hermano.guardia.test.ts` lo vigila sobre la fuente de este
 * archivo, porque un `localStorage.setItem` de buena fe —«para que no se pierda al recargar»— no
 * rompería ningún test de los que miden comportamiento.
 *
 * ⚠️ EL PROVEEDOR PINTA `{children}` SIEMPRE, SIN NINGUNA RAMA. Envuelve al contenido del portal
 * (es la única forma de que el «?» del encabezado, que vive dentro de `{children}`, alcance el
 * contexto), así que un `return null` suyo dejaría la aplicación entera en blanco. No hay ningún
 * `if` entre la firma y el `return`: eso es lo que hace que R22 no dependa de que nadie se
 * equivoque aquí. El PANEL, que sí puede fallar de verdad, es HERMANO de `{children}` y no lo
 * envuelve — `app/(app)/layout.tsx`.
 *
 * ⚠️ `fetchImpl` SE INYECTA. La suite no toca la red (hay guardia que lo vigila), así que el
 * transporte entra por la puerta como en los bordes del repo. En producción el valor por defecto
 * es el `fetch` del navegador y nadie pasa nada.
 */

/** Una imagen ya lista para viajar: comprimida, en base64 y sin el prefijo `data:`. */
export type { ImagenAdjunta };

/** Un turno de la conversación, tal y como se pinta. */
export interface TurnoAsistente {
  id: string;
  autor: "usuario" | "asistente";
  /** Para el asistente, el texto YA SIN los marcadores de cita. */
  texto: string;
  /** Sólo en turnos del usuario. Una por mensaje (Q6). */
  imagenes?: readonly ImagenAdjunta[];
  /** `true` mientras el stream de ESE turno sigue llegando: la pantalla no se queda quieta (R19). */
  enCurso?: boolean;
  /**
   * El conjunto de documentos que el servidor entregó PARA ESTE TURNO (evento `inicio`).
   *
   * ⚠️ VA POR TURNO Y NO EN EL PROVEEDOR ENTERO, y no es un detalle: las citas de una respuesta
   * se validan contra lo que se entregó EN ESA consulta (R24). Guardar un único conjunto «el
   * último» haría que una respuesta vieja se validara contra documentos nuevos.
   */
  entregados?: readonly DocumentoAnunciado[];
}

/** Lo que el panel necesita saber. Todo lo demás es interno. */
export interface AsistenteContexto {
  abierto: boolean;
  /** El slug del documento de la pantalla desde la que se abrió, o `null` si no tiene. */
  slugDePartida: string | null;
  /** La ruta desde la que se abrió. Viaja como `rutaActual` para que el servidor resuelva R27. */
  rutaDeApertura: string | null;
  /** El título del documento de partida, en cuanto el servidor lo dice. `null` hasta entonces. */
  tituloDePartida: string | null;
  turnos: readonly TurnoAsistente[];
  /** Hay una consulta en vuelo: la barra de entrada se bloquea. */
  enviando: boolean;
  /**
   * Un rechazo PREVIO al stream (401/403/422/409 tope/500), con el mensaje que el servidor
   * redactó. No es lo mismo que un turno fallido: aquí no llegó a haber respuesta.
   */
  errorPrevio: string | null;
  abrir(destino?: { slug?: string | null; ruta?: string | null }): void;
  cerrar(): void;
  preguntar(texto: string, imagen?: ImagenAdjunta): Promise<void>;
}

/**
 * El valor sin proveedor: cerrado, vacío y con operaciones que no hacen nada.
 *
 * Mismo criterio —y mismo motivo— que `useMapaAyuda` y `useTema`: `AyudaBoton` vive en
 * `PageHeader`, que es presentación pura y se monta suelto en una veintena de archivos de test de
 * otras features. Exigir el proveedor convertiría un detalle de presentación en un requisito de
 * todos ellos. Y el «?» sólo se pinta cuando HAY mapa de ayuda, que es el mismo layout que monta
 * este proveedor: en la aplicación los dos están o no están a la vez.
 */
const SIN_PROVEEDOR: AsistenteContexto = {
  abierto: false,
  slugDePartida: null,
  rutaDeApertura: null,
  tituloDePartida: null,
  turnos: [],
  enviando: false,
  errorPrevio: null,
  abrir: () => {},
  cerrar: () => {},
  preguntar: async () => {},
};

const Contexto = createContext<AsistenteContexto | null>(null);

export function useAsistente(): AsistenteContexto {
  return useContext(Contexto) ?? SIN_PROVEEDOR;
}

/** La ruta del borde. Una constante para que el test afirme contra ELLA y no contra una copia. */
export const RUTA_ASISTENTE = "/api/asistente";

/** El mensaje de un fallo de RED —el servidor ni contestó—. Propio, nunca el error crudo (R21). */
const MSG_SIN_RESPUESTA =
  "No se pudo hablar con el asistente. Revisá la conexión y probá de nuevo; la ayuda de la pantalla sigue abierta.";

export interface AsistenteProviderProps {
  children: ReactNode;
  /** El transporte. Se inyecta en los tests; en producción nadie lo pasa. */
  fetchImpl?: typeof fetch;
}

export function AsistenteProvider({ children, fetchImpl }: Readonly<AsistenteProviderProps>) {
  const [abierto, setAbierto] = useState(false);
  const [slugDePartida, setSlugDePartida] = useState<string | null>(null);
  const [rutaDeApertura, setRutaDeApertura] = useState<string | null>(null);
  const [tituloDePartida, setTituloDePartida] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<readonly TurnoAsistente[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [errorPrevio, setErrorPrevio] = useState<string | null>(null);

  // El contador de ids de turno. Un `ref` y no `useState` porque cambiarlo no tiene que repintar,
  // y `Date.now()` daría el mismo valor a dos turnos creados en el mismo tick.
  const siguienteId = useRef(0);
  const nuevoId = useCallback(() => `t${siguienteId.current++}`, []);

  const abrir = useCallback(
    (destino?: { slug?: string | null; ruta?: string | null }) => {
      setSlugDePartida(destino?.slug ?? null);
      setRutaDeApertura(destino?.ruta ?? null);
      setAbierto(true);
    },
    [],
  );

  // ⚠️ CERRAR NO BORRA LA CONVERSACIÓN. Quien cierra para mirar la pantalla y vuelve a abrir
  // espera encontrar lo que estaba leyendo; perderlo al cerrar convertiría el panel en algo que
  // hay que mantener abierto para que sirva. Lo que la pierde es RECARGAR, que es R30.
  const cerrar = useCallback(() => setAbierto(false), []);

  const preguntar = useCallback(
    async (texto: string, imagen?: ImagenAdjunta) => {
      const limpio = texto.trim();
      if (limpio === "" && imagen === undefined) return;

      const turnoUsuario: TurnoAsistente = {
        id: nuevoId(),
        autor: "usuario",
        texto: limpio,
        ...(imagen ? { imagenes: [imagen] } : {}),
      };
      const idRespuesta = nuevoId();

      // La conversación que VIAJA es la de antes más la pregunta de ahora: el servidor no guarda
      // nada, así que el hilo entero es responsabilidad del cliente (D10).
      const paraElServidor = [...turnos, turnoUsuario].map((turno) => ({
        autor: turno.autor,
        texto: turno.texto,
        ...(turno.imagenes && turno.imagenes.length > 0 ? { imagenes: turno.imagenes } : {}),
      }));

      setErrorPrevio(null);
      setEnviando(true);
      setTurnos((previos) => [
        ...previos,
        turnoUsuario,
        { id: idRespuesta, autor: "asistente", texto: "", enCurso: true },
      ]);

      const parchear = (cambio: Partial<TurnoAsistente>) =>
        setTurnos((previos) =>
          previos.map((turno) => (turno.id === idRespuesta ? { ...turno, ...cambio } : turno)),
        );

      try {
        const respuesta = await (fetchImpl ?? fetch)(RUTA_ASISTENTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mensajes: paraElServidor,
            // ⚠️ El schema del borde es `.strict()`: una clave de más es un 422, no un campo
            // ignorado. Por eso `rutaActual` sólo se incluye cuando existe.
            ...(rutaDeApertura ? { rutaActual: rutaDeApertura } : {}),
          }),
        });

        // ⭑ LOS RECHAZOS PREVIOS NO VIAJAN POR EL STREAM (401/403/422/409 tope/500). Llegan como
        // una respuesta normal con el `AppErrorShape` del repo, y su `message` ya está redactado
        // por el servidor —el del tope dice el número y cuándo vuelve—. Aquí NO se reescribe: un
        // mensaje propio del cliente taparía el que se escribió para que se entendiera.
        if (!respuesta.ok) {
          const forma = (await respuesta.json().catch(() => null)) as { message?: unknown } | null;
          const mensaje =
            typeof forma?.message === "string" && forma.message !== ""
              ? forma.message
              : MSG_SIN_RESPUESTA;
          setErrorPrevio(mensaje);
          // El turno vacío del asistente se retira: no hubo respuesta que enseñar.
          setTurnos((previos) => previos.filter((turno) => turno.id !== idRespuesta));
          return;
        }

        let crudo = "";
        let entregados: readonly DocumentoAnunciado[] = [];

        for await (const trozo of leerNdjson(respuesta)) {
          // `leerNdjson` sólo cede cadenas terminadas en `\n`, así que aquí el `resto` de
          // `partirNdjson` es siempre vacío: la recomposición de líneas cortadas ya ocurrió
          // abajo, que es el único sitio que ve los trozos de red de verdad.
          const { eventos } = partirNdjson(trozo);
          for (const evento of eventos) {
            switch (evento.tipo) {
              case "inicio":
                entregados = evento.documentos;
                parchear({ entregados });
                // R27 — el título del documento de partida lo dice el SERVIDOR. El panel no
                // cruza rutas ni conoce el catálogo.
                if (evento.partida !== null) {
                  const doc = evento.documentos.find((d) => d.slug === evento.partida);
                  if (doc) {
                    setSlugDePartida(doc.slug);
                    setTituloDePartida(doc.titulo);
                  }
                }
                break;
              case "texto":
                // ⚠️ SE ACUMULA EL TEXTO CRUDO —con los marcadores— y el panel es quien los
                // quita y valida las citas con `citasDe`/`textoSinMarcadores`. Partir un
                // marcador entre dos trozos es lo normal en un stream; limpiarlo aquí trozo a
                // trozo dejaría medio marcador visible en pantalla.
                crudo += evento.texto;
                parchear({ texto: crudo });
                break;
              case "fin":
                break;
              case "error":
                // Un fallo CON el stream ya empezado. Se conserva lo que ya había llegado y se
                // añade el aviso: borrar la respuesta a medias sería perder lo único útil.
                crudo = crudo === "" ? evento.message : `${crudo}\n\n${evento.message}`;
                parchear({ texto: crudo });
                break;
            }
          }
        }

        parchear({ texto: crudo, enCurso: false, entregados });
      } catch {
        // Ni siquiera hubo respuesta: red caída, pestaña sin conexión. Mensaje propio (R21).
        setErrorPrevio(MSG_SIN_RESPUESTA);
        setTurnos((previos) => previos.filter((turno) => turno.id !== idRespuesta));
      } finally {
        setEnviando(false);
      }
    },
    // ⚠️ `turnos` ESTÁ EN LAS DEPENDENCIAS A PROPÓSITO, y por eso `preguntar` se recrea en cada
    // render. La alternativa —una función estable que lea la conversación de un `ref`— escribe
    // ese `ref` durante el render, que es lo que el linter de este repo prohíbe y con razón.
    // El handler siempre se invoca desde el render más reciente, así que el cuerpo que viaja
    // lleva SIEMPRE el hilo entero; con una función estable, la segunda pregunta de una ráfaga
    // habría salido sin la primera.
    [fetchImpl, nuevoId, rutaDeApertura, turnos],
  );

  const valor = useMemo<AsistenteContexto>(
    () => ({
      abierto,
      slugDePartida,
      rutaDeApertura,
      tituloDePartida,
      turnos,
      enviando,
      errorPrevio,
      abrir,
      cerrar,
      preguntar,
    }),
    [
      abierto,
      slugDePartida,
      rutaDeApertura,
      tituloDePartida,
      turnos,
      enviando,
      errorPrevio,
      abrir,
      cerrar,
      preguntar,
    ],
  );

  // ⚠️ SIN NINGUNA RAMA. Ver la cabecera: este proveedor envuelve el portal entero.
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * El cuerpo NDJSON, trozo a trozo, con las líneas ya recompuestas.
 *
 * Cede cadenas que SIEMPRE terminan en `\n` o están vacías, de modo que quien las parte con
 * `partirNdjson` nunca recibe una línea a medias. El `resto` se guarda aquí y se antepone al
 * siguiente trozo; sin eso, un corte de red en mitad de una línea perdería ese evento sin ruido.
 *
 * Si el cuerpo no es legible por trozos —un doble de test que devuelve texto entero, un navegador
 * sin `ReadableStream`— se cae a `text()`: la respuesta llega de golpe, pero llega.
 */
async function* leerNdjson(respuesta: Response): AsyncGenerator<string> {
  const cuerpo = respuesta.body;
  if (!cuerpo || typeof cuerpo.getReader !== "function") {
    yield await respuesta.text();
    return;
  }

  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    pendiente += decodificador.decode(value, { stream: true });
    const corte = pendiente.lastIndexOf("\n");
    if (corte === -1) continue;
    yield pendiente.slice(0, corte + 1);
    pendiente = pendiente.slice(corte + 1);
  }
  // Lo que quedó sin `\n` al cerrarse el stream: se cede igual, por si el servidor no lo puso.
  if (pendiente.trim() !== "") yield `${pendiente}\n`;
}
