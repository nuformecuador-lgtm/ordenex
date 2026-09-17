"use client";

import { Fragment, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Bot,
  ChevronRight,
  FileText,
  ImagePlus,
  SendHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { citasDe, textoSinMarcadores } from "@/lib/asistente/citas";
import { ASISTENTE_IMAGEN_MEDIOS } from "@/lib/config/asistente";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import { cn } from "@/lib/utils";
import {
  useAsistente,
  type ImagenAdjunta,
  type TurnoAsistente,
} from "@/providers/AsistenteProvider";

/**
 * ⭑ FICHA 436 (T15, T16 — R22, R25, R27, R28, R29) — EL PANEL DEL ASISTENTE.
 *
 * Maquetas: `design-asistente/Main.dc.html` (teléfono, 390×844), `Escritorio.dc.html` (oficina,
 * 1440×900) y `Estados.dc.html` (el tope del día y una captura adjunta).
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * R22 — SE MONTA UNA SOLA VEZ, Y COMO **HERMANO** DE `{children}`
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * En `app/(app)/layout.tsx`, al lado de `PushReactivacion` y `RevisionSinpeBodega` y por el mismo
 * motivo escrito allí: ese layout no se pinta sin sesión y persiste entre navegaciones. **Jamás
 * envolviendo `{children}`**: un envoltorio PODRÍA dejar de pintar la página con un `return null`;
 * un hermano no tiene dónde hacerlo. Eso es lo que convierte R22 en estructura en vez de en una
 * promesa, y `asistente-panel-hermano.guardia.test.ts` lo vigila sobre la forma del árbol.
 *
 * Y por eso todo lo que puede fallar —la red, el proveedor, el tope— se pinta DENTRO del panel:
 * un rechazo del asistente nunca sale de estos límites.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LO QUE NO ESTÁ, Y NO ES UN OLVIDO
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ **NO HAY BOTÓN DE AUDIO** (R29). No es «todavía no»: el modelo que responde no transcribe
 * voz, así que un micrófono aquí sería una promesa falsa. No hay control de grabación, y el
 * `accept` del adjunto es la LISTA BLANCA de `ASISTENTE_IMAGEN_MEDIOS` —nunca un comodín de
 * tipo, y `audio` no cabe—. La guardia lo mide sobre la fuente de este archivo.
 *
 * ⚠️ Y AQUÍ NO SE ESCRIBE UNA BARRA SEGUIDA DE ASTERISCO, NI EN UN COMENTARIO. Medido el
 * 2026-09-17: decir «image» + barra + asterisco en el comentario de más abajo abría un COMENTARIO
 * DE BLOQUE para los barridos de este repo, que se tragaban treinta líneas de JSX —incluido el
 * `onChange` del adjunto— y dejaban a `superficie-de-uso.guardia.test.ts` denunciando un handler
 * «sin referencia» que sí la tenía. Peor todavía: la comprobación de audio de la guardia de esta
 * ficha pasaba porque miraba una región que ya no existía.
 *
 * ⚠️ **EL PANEL NO VALIDA CITAS POR SU CUENTA** (R23/R24/R25). Los documentos del evento `inicio`
 * SON el conjunto entregado, y `citasDe` es la función —pura y ya probada— que decide cuáles se
 * pintan. Aquí no hay ninguna lista de slugs ni ningún `catálogo`.
 *
 * ⚠️ **EL PANEL NO CRUZA RUTAS** (R27). Qué documento es el de partida lo dice el servidor en el
 * `inicio`; lo único que el cliente aporta es el slug que el «?» ya conocía por el mapa de la 433.
 */

/**
 * ⭑ R28 — EL AVISO DE DATOS. **Siempre visible, bajo la barra de entrada.**
 *
 * No va en un desplegable, ni en un icono con tooltip, ni en un documento: un aviso que hay que
 * abrir es un aviso que nadie lee, y esto es lo único que le dice a la persona que lo que escribe
 * sale de la empresa. El test lo busca por su LITERAL y comprueba que no cuelga de ningún
 * `<details>`; sin ese ancla, un aviso se «mejora» hasta desaparecer.
 */
export const AVISO_DATOS_ASISTENTE =
  "Si mandás una captura, su contenido se procesa con un proveedor externo de inteligencia artificial. Evitá enviar datos de clientes si no hace falta.";

/**
 * ⭑ EL TOPE DE BYTES CON EL QUE SE ENVÍA, Y POR QUÉ NO SON LOS 5 MB DEL SCHEMA.
 *
 * El schema del borde admite 5 MB sobre la cadena base64, pero el límite de CUERPO de un Route
 * Handler en Vercel es ~4,5 MB — y base64 infla 4 caracteres por cada 3 bytes. Es decir: una
 * imagen de 4 MB que el schema aceptaría viaja como 5,3 MB de cadena y **la plataforma la corta
 * antes de que ningún código nuestro la vea**. En local no pasa, porque en local no hay ese
 * límite: ése es exactamente el fallo que sólo aparece en producción.
 *
 * 3 MB de bytes = 4 MB de base64, con medio mega de margen para el resto del JSON. Por debajo de
 * eso se manda tal cual; por encima, se recomprime.
 */
const TOPE_BYTES_ENVIO = 3 * 1024 * 1024;

/** Lo que se le dice a quien adjunta algo que no se pudo dejar en tamaño. */
const MSG_IMAGEN_PESADA =
  "Esa imagen es demasiado grande para enviarla. Probá con una captura de pantalla en vez de una foto.";
const MSG_IMAGEN_FORMATO =
  "Ese formato de imagen no se puede enviar. Serví una captura en PNG, JPG o WebP.";

/** Una imagen ya lista para viajar, con lo que hace falta para pintarla mientras tanto. */
interface AdjuntoListo extends ImagenAdjunta {
  nombre: string;
}

export function AsistentePanel() {
  const asistente = useAsistente();

  return (
    <Sheet
      open={asistente.abierto}
      onOpenChange={(abierto) => {
        if (!abierto) asistente.cerrar();
      }}
      // ⚠️ NO MODAL, A PROPÓSITO. En la oficina el panel va ACOPLADO al lado de la tabla
      // (`Escritorio.dc.html`): se pregunta MIRANDO lo que no se entiende. Un diálogo modal
      // apagaría la pantalla de debajo justo cuando es la mitad de la pregunta. Y tiene una
      // segunda consecuencia, que es la que hace R22 medible: el resto del documento no queda
      // `inert` ni `aria-hidden`, así que un test puede afirmar que la página SIGUE ahí con el
      // panel abierto y su error pintado.
      modal={false}
    >
      <SheetContent
        side="right"
        // El botón de cerrar de la primitiva es de 32 px y dice «Close». Aquí hace falta uno de
        // 44 px —el área de toque de la maqueta— y en español.
        showCloseButton={false}
        aria-label="Asistente"
        // Teléfono: ocupa la pantalla entera (390 px de la maqueta). Oficina: la columna de 420
        // px acoplada a la derecha (`Escritorio.dc.html`). `max-w-full` impide que los 420 px
        // desborden en horizontal en un viewport más estrecho.
        //
        // ⚠️ LOS PREFIJOS `data-[side=right]:` NO SOBRAN, Y SE DESCUBRIÓ EN EL NAVEGADOR. La
        // primitiva trae `data-[side=right]:w-3/4` y `data-[side=right]:sm:max-w-sm`; escribir
        // aquí `w-full sm:max-w-[420px]` a secas NO los sustituye —`tailwind-merge` sólo dedupe
        // clases con el MISMO prefijo de variante—, así que las dos sobreviven y gana la de la
        // primitiva. Medido a 2026-09-17: el panel salía de 292,5 px en el teléfono (¾ de 390) y
        // de 384 px en la oficina (`max-w-sm`), en vez de 390 y 420. Con el prefijo, se sustituyen.
        className="flex flex-col gap-0 overflow-x-hidden p-0 data-[side=right]:w-full data-[side=right]:max-w-full data-[side=right]:sm:max-w-[420px]"
      >
        <CuerpoDelPanel />
      </SheetContent>
    </Sheet>
  );
}

/**
 * El contenido. Separado para que su estado —el borrador y el adjunto— nazca y muera con la
 * apertura del panel: la primitiva desmonta el popup al cerrar, así que una captura que alguien
 * eligió y no envió no reaparece tres pantallas después.
 */
function CuerpoDelPanel() {
  const { slugDePartida, tituloDePartida, turnos, enviando, errorPrevio, cerrar, preguntar } =
    useAsistente();

  const [borrador, setBorrador] = useState("");
  const [adjunto, setAdjunto] = useState<AdjuntoListo | null>(null);
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const campoArchivo = useRef<HTMLInputElement>(null);

  async function alElegirArchivo(file: File | undefined) {
    if (!file) return;
    setErrorAdjunto(null);
    setPreparando(true);
    try {
      const listo = await prepararImagen(file);
      if (listo === "formato") setErrorAdjunto(MSG_IMAGEN_FORMATO);
      else if (listo === "pesada") setErrorAdjunto(MSG_IMAGEN_PESADA);
      else setAdjunto(listo);
    } finally {
      setPreparando(false);
      // Sin esto, elegir DOS VECES el mismo archivo no dispara `change` la segunda.
      if (campoArchivo.current) campoArchivo.current.value = "";
    }
  }

  function quitarAdjunto() {
    setAdjunto(null);
    setErrorAdjunto(null);
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || preparando) return;
    if (borrador.trim() === "" && adjunto === null) return;
    const imagen = adjunto ? { medio: adjunto.medio, datosBase64: adjunto.datosBase64 } : undefined;
    setBorrador("");
    setAdjunto(null);
    await preguntar(borrador, imagen);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* ── Cabecera ─────────────────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2.5 border-b bg-card px-3 py-3 sm:px-4">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground"
        >
          <Bot className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-sm font-semibold">Asistente</SheetTitle>
          <SheetDescription className="text-xs">
            Responde sobre cómo usar Ordenex
          </SheetDescription>
        </div>
        <button
          type="button"
          onClick={cerrar}
          // 44 px de área de toque, que es la medida de la maqueta en teléfono. El icono es más
          // pequeño; lo que tiene que llegar a 44 es el objetivo, no el dibujo.
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Cerrar el asistente"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>

      {/* ── R27 — LA PRIMERA ACCIÓN VISIBLE DEL PANEL ────────────────────────────────────────
          Va aquí arriba, antes de la conversación, y no al final: es lo que hace que abrir el
          asistente NO PIERDA NADA de lo que el «?» daba antes (la ayuda escrita de esta
          pantalla, que no tiene tope y no cuesta nada). Si la pantalla no tiene documento para
          este rol, no se pinta: nunca un enlace a un vacío. */}
      {slugDePartida !== null && (
        <Link
          href={`/ayuda/${slugDePartida}`}
          onClick={cerrar}
          className="flex min-h-11 shrink-0 items-center gap-2.5 border-b bg-card px-3 text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
          data-ayuda-slug={slugDePartida}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">Leer la ayuda de esta pantalla</span>
          {tituloDePartida !== null && (
            <span className="shrink-0 truncate text-[13px] text-muted-foreground">
              {tituloDePartida}
            </span>
          )}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}

      {/* ── Conversación ─────────────────────────────────────────────────────────────────── */}
      <div
        // `role="log"` + `aria-live="polite"`: la respuesta llega por trozos (R19) y quien usa
        // lector de pantalla tiene que enterarse sin perseguir el foco.
        role="log"
        aria-live="polite"
        aria-label="Conversación con el asistente"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3.5 sm:px-4"
      >
        {turnos.length === 0 && errorPrevio === null ? (
          <p className="text-sm text-muted-foreground">
            Preguntá lo que no te cuadre de esta pantalla. Respondo sobre cómo se usa Ordenex; no
            veo tus órdenes ni tu dinero.
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {turnos.map((turno) => (
            <li key={turno.id} className="min-w-0">
              {turno.autor === "usuario" ? (
                <TurnoDelUsuario turno={turno} />
              ) : (
                <TurnoDelAsistente turno={turno} />
              )}
            </li>
          ))}
        </ul>

        {/* Un rechazo PREVIO al stream: sin sesión, rol no admitido, el tope del día, el
            proveedor caído. El mensaje es el que redactó el servidor —el del tope dice el número
            y cuándo vuelve—, y debajo va la salida que siempre queda: la ayuda escrita.
            Maqueta: `Estados.dc.html`. */}
        {errorPrevio !== null && (
          <div role="alert" className="mt-3 rounded-[10px] border bg-card p-3.5">
            <p className="text-sm text-foreground">{errorPrevio}</p>
            {slugDePartida !== null && (
              <Link
                href={`/ayuda/${slugDePartida}`}
                onClick={cerrar}
                className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-[10px] border bg-background text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                Leer la ayuda de esta pantalla
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Barra de entrada ─────────────────────────────────────────────────────────────── */}
      <form
        onSubmit={enviar}
        className="shrink-0 border-t bg-card px-3 pt-2.5 pb-3.5 sm:px-4"
        aria-label="Preguntar al asistente"
      >
        {adjunto !== null && (
          <div className="mb-2 flex items-center gap-2 rounded-[10px] border bg-background p-2">
            {/* La vista previa sale del MISMO base64 que va a viajar, no de un `createObjectURL`:
                es el dato que se está por mandar y no hay ningún objeto que revocar después. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${adjunto.medio};base64,${adjunto.datosBase64}`}
              alt={`Captura adjunta: ${adjunto.nombre}`}
              className="size-12 shrink-0 rounded-md border object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {adjunto.nombre}
            </span>
            <button
              type="button"
              onClick={quitarAdjunto}
              className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Quitar la imagen adjunta"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {errorAdjunto !== null && (
          <p role="alert" className="mb-2 flex items-start gap-2 rounded-[10px] bg-accent p-2.5 text-xs text-foreground">
            <TriangleAlert className="mt-px size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
            {errorAdjunto}
          </p>
        )}

        <div className="flex items-center gap-2">
          {/* ⭑ R29 — IMAGEN SÍ. El input real va oculto y la etiqueta es el botón de 44 px; así
              el control sigue siendo un `<input type="file">` de verdad —con su `accept`
              medible— y no un botón que simula uno. */}
          <label
            htmlFor="asistente-imagen"
            className={cn(
              "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border bg-background text-foreground",
              "hover:bg-muted focus-within:ring-2 focus-within:ring-ring",
              (enviando || preparando) && "pointer-events-none opacity-50",
            )}
          >
            <ImagePlus className="size-[18px]" aria-hidden="true" />
            <span className="sr-only">Adjuntar una captura</span>
          </label>
          <input
            ref={campoArchivo}
            id="asistente-imagen"
            type="file"
            className="sr-only"
            // ⚠️ LISTA BLANCA, NUNCA UN COMODÍN DE TIPO, Y NUNCA AUDIO (R29, D12). Sale de la
            // misma constante que valida el servidor: dos listas serían dos verdades.
            accept={ASISTENTE_IMAGEN_MEDIOS.join(",")}
            // Una por mensaje (Q6): ni `multiple`, ni `capture` —que abriría la cámara y se
            // saltaría la captura de pantalla, que es lo que de verdad sirve para preguntar—.
            disabled={enviando || preparando}
            onChange={(evento) => void alElegirArchivo(evento.target.files?.[0])}
          />

          <Input
            value={borrador}
            onChange={(evento) => setBorrador(evento.target.value)}
            placeholder="Escribí tu pregunta…"
            aria-label="Escribí tu pregunta"
            disabled={enviando}
            className="h-11 flex-1 rounded-[10px]"
          />

          <button
            type="submit"
            disabled={enviando || preparando || (borrador.trim() === "" && adjunto === null)}
            className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Enviar la pregunta"
          >
            <SendHorizontal className="size-[18px]" aria-hidden="true" />
          </button>
        </div>

        {/* ⭑ R28 — EL AVISO, AQUÍ Y SIEMPRE A LA VISTA. Hermano directo de la barra de entrada,
            sin `<details>`, sin acordeón y sin tooltip. Ver la constante, arriba. */}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {AVISO_DATOS_ASISTENTE}
        </p>
      </form>
    </div>
  );
}

/** La burbuja de quien pregunta: naranja, a la derecha (maqueta). */
function TurnoDelUsuario({ turno }: Readonly<{ turno: TurnoAsistente }>) {
  return (
    <div className="flex flex-col items-end gap-2">
      {turno.imagenes?.map((imagen, indice) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={indice}
          src={`data:${imagen.medio};base64,${imagen.datosBase64}`}
          alt="Captura que mandaste"
          className="max-w-[70%] rounded-[14px] rounded-br-sm border"
        />
      ))}
      {turno.texto !== "" && (
        <p className="max-w-[80%] rounded-[14px] rounded-br-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed break-words text-primary-foreground">
          {turno.texto}
        </p>
      )}
    </div>
  );
}

/**
 * La respuesta: tarjeta blanca a la izquierda y, debajo, los documentos citados.
 *
 * ⚠️ AQUÍ NO SE DECIDE NADA SOBRE LAS CITAS. `citasDe` recibe el texto crudo y **el conjunto que
 * el servidor entregó en ESTA consulta**, y devuelve las que sobreviven (R23/R24). Si no devuelve
 * ninguna, no se pinta ninguna sección de fuentes ni ningún enlace — eso es R25, y es la
 * ausencia de este bloque entero, no un bloque vacío.
 */
function TurnoDelAsistente({ turno }: Readonly<{ turno: TurnoAsistente }>) {
  const entregados = (turno.entregados ?? []).map((doc) => ({
    slug: doc.slug,
    titulo: doc.titulo,
    // `citasDe` sólo mira `slug` y `titulo`. El CUERPO nunca cruza al cliente —el evento
    // `inicio` lo omite a propósito—, así que se rellena vacío para encajar en el tipo del
    // puerto en vez de duplicar aquí una versión cliente de la función que ya está probada.
    cuerpo: "",
  }));
  const citas = citasDe(turno.texto, entregados);
  const texto = textoSinMarcadores(turno.texto);

  return (
    <div>
      <div className="rounded-[14px] rounded-bl-sm border bg-card px-3.5 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-card-foreground">
        {texto === "" && turno.enCurso ? (
          <span className="text-muted-foreground">Pensando…</span>
        ) : (
          trozosConNegrita(texto).map((trozo, indice) =>
            trozo.fuerte ? (
              <strong key={indice} className="font-semibold">
                {trozo.texto}
              </strong>
            ) : (
              <Fragment key={indice}>{trozo.texto}</Fragment>
            ),
          )
        )}
      </div>

      {citas.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {citas.map((cita) => (
            <li key={cita.slug}>
              <Link
                href={cita.href}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="size-3" aria-hidden="true" />
                {cita.titulo}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ⭑ T16 — DEJA LA IMAGEN EN TAMAÑO **ANTES** DE MANDARLA, y por qué eso no es una optimización.
 *
 * El límite de cuerpo de un Route Handler en Vercel (~4,5 MB) está POR DEBAJO del tope que el
 * schema admite (5 MB de base64). Una foto de teléfono sin comprimir pesa 3-15 MB: en local
 * funciona —no hay ese límite— y en producción la corta la plataforma antes de que ningún código
 * nuestro la vea. Comprimir aquí es lo que hace que ese fallo no exista.
 *
 * Devuelve `"formato"` o `"pesada"` en vez de lanzar: los dos son cosas que la persona puede
 * arreglar, y para eso hay que contárselas, no tirar una excepción.
 */
async function prepararImagen(file: File): Promise<AdjuntoListo | "formato" | "pesada"> {
  const admitido = (tipo: string): tipo is (typeof ASISTENTE_IMAGEN_MEDIOS)[number] =>
    (ASISTENTE_IMAGEN_MEDIOS as readonly string[]).includes(tipo);

  let candidato = file;

  // Sólo se toca lo que hace falta tocar: un PNG de 400 KB es una captura de pantalla y
  // recodificarla a JPEG le emborronaría justo el texto que se quiere enseñar.
  if (!admitido(candidato.type) || candidato.size > TOPE_BYTES_ENVIO) {
    candidato = await comprimirImagen(file, {
      maxLadoLargo: 1600,
      calidad: 0.85,
      // `0` y `false`: aquí la conversión es OBLIGATORIA, no una mejora. Es el mismo par que usa
      // el chat saliente (feature 316) cuando tiene que convertir sí o sí.
      saltarSiMenorA: 0,
      devolverOriginalSiMayor: false,
    });
    // Segunda pasada, más corta, sólo si la primera no bastó: una captura de una pantalla muy
    // grande puede seguir por encima a 1600 px.
    if (candidato.size > TOPE_BYTES_ENVIO) {
      candidato = await comprimirImagen(candidato, {
        maxLadoLargo: 1200,
        calidad: 0.7,
        saltarSiMenorA: 0,
        devolverOriginalSiMayor: false,
      });
    }
  }

  // `comprimirImagen` NUNCA lanza: ante cualquier tropiezo devuelve el archivo original. Por eso
  // las dos comprobaciones van DESPUÉS y sobre el resultado, no sobre la entrada.
  if (!admitido(candidato.type)) return "formato";
  if (candidato.size > TOPE_BYTES_ENVIO) return "pesada";

  return {
    medio: candidato.type,
    datosBase64: await aBase64(candidato),
    nombre: file.name,
  };
}

/**
 * ⭑ LA NEGRITA DEL MODELO, Y POR QUÉ HAY QUE PINTARLA — medido en el navegador el 2026-09-17.
 *
 * El modelo responde en Markdown y usa `**` para lo importante («**Si sos de oficina**: …»). Sin
 * esto, la pantalla enseñaba los asteriscos EN CRUDO, seis u ocho por respuesta: exactamente el
 * texto que la maqueta pinta en negrita (`Main.dc.html`, los `<strong>` de la tarjeta blanca).
 * **Ningún test lo veía** —los tests afirman el texto, y `toHaveTextContent` normaliza— y el
 * párrafo era perfectamente legible; sólo era feo de una forma que se nota en cada respuesta.
 *
 * ⚠️ SE PINTA **SOLO** LA NEGRITA, y no se mete un intérprete de Markdown. Lo demás que el modelo
 * escribe —guiones de lista, párrafos— ya sale bien con `whitespace-pre-wrap`, y una biblioteca
 * de Markdown en este panel traería enlaces y HTML crudo dentro de un texto que viene de un
 * proveedor externo: una superficie nueva por un problema que no tenemos.
 *
 * No hay `dangerouslySetInnerHTML` en ninguna rama: se devuelven TROZOS y React los escapa.
 */
export function trozosConNegrita(texto: string): Array<{ texto: string; fuerte: boolean }> {
  const trozos: Array<{ texto: string; fuerte: boolean }> = [];
  const patron = /\*\*([^*]+)\*\*/g;
  let desde = 0;
  for (let hallazgo = patron.exec(texto); hallazgo !== null; hallazgo = patron.exec(texto)) {
    if (hallazgo.index > desde) {
      trozos.push({ texto: texto.slice(desde, hallazgo.index), fuerte: false });
    }
    trozos.push({ texto: hallazgo[1], fuerte: true });
    desde = hallazgo.index + hallazgo[0].length;
  }
  // Un `**` suelto —o sin cerrar— NO se toca: se queda como texto, que es menos malo que comerse
  // media respuesta buscando un cierre que no llega.
  if (desde < texto.length) trozos.push({ texto: texto.slice(desde), fuerte: false });
  return trozos;
}

/** El contenido en base64, SIN el prefijo `data:` —que es como lo espera el borde—. */
async function aBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Por trozos: `String.fromCharCode(...bytes)` con un array de megas revienta la pila del
  // intérprete, y lo hace en el teléfono de alguien, no aquí.
  const TROZO = 0x8000;
  let binario = "";
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}
