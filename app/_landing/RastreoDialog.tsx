"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import { PARAM_GUIA } from "./guia-en-url";
import {
  ETIQUETA_POR_HITO,
  type ResultadoRastreoPublico,
} from "@/lib/types/rastreo-publico";

// Feature 229 (T3.1, design §4.2) — el MODAL de rastreo publico del envio.
//
// Vive junto a la pagina que lo usa y no en `components/shared/`: se monta en un solo sitio
// —la nav de la landing— y no tiene logica reutilizable (`docs/architecture.md`, «sin
// sobre-ingenieria»). Se promovera el dia que una segunda superficie lo necesite.
//
// TRES COSAS QUE ESTE ARCHIVO SOSTIENE, y que no hay que deshacer por descuido:
//
//  1. **PALETA FIJA, y es el riesgo concreto de esta feature (R29).** La landing es clara POR
//     DISENO: `app/page.tsx` monta su subarbol con `tema-claro`. Pero el dialogo se PORTALEA
//     fuera de ese subarbol, asi que ahi dentro ya no hereda nada: si el usuario eligio tema
//     oscuro (feature 211), el envoltorio del portal lleva `.dark` y el modal saldria oscuro en
//     mitad de una landing clara. Por eso `DialogContent` lleva `tema-claro` EXPLICITO. Y por
//     eso los campos y el boton se pintan con la paleta de la landing (`brand`, `navy-deep`,
//     `asfalto-*`, `kraft-*`) en vez de con `Input`/`Button`: esas primitivas traen variantes
//     de tema, que `tema-claro` no apaga (fija los tokens, no el variant).
//  2. **EL RECHAZO ES UNO SOLO (R28).** El servidor devuelve el MISMO `no_encontrado` para los
//     cuatro casos (guia inexistente, segundo factor errado, orden borrada, telefono corto): no
//     hay forma —ni la tiene que haber— de que la UI los distinga. Un texto propio por caso
//     convertiria el modal en un oraculo de existencia de guias. El unico rechazo con texto
//     propio es el del limite de intentos, y tampoco nombra la guia.
//  3. **EL RESULTADO MUERE AL CERRAR (R30).** Ni URL, ni `localStorage`, ni router: se limpia
//     el formulario y el resultado en el `onOpenChange`. Consecuencia aceptada y declarada
//     (design §0, F2/F3): no hay enlace compartible del seguimiento.
//
// Y lo que este modal NO hace (design §4.3): no re-deriva ninguna regla del servidor. Recibe
// hitos ya mapeados y fechas ya formateadas en la zona del negocio, y solo elige la etiqueta.
// No conoce ningun `order_status.value`.

/** R28 — el MISMO texto para los cuatro casos de rechazo. Fijo, sin interpolar la entrada. */
const MENSAJE_NO_ENCONTRADO =
  "No encontramos un envío con esos datos. Revisa el número de guía y los últimos 4 dígitos del teléfono.";

/** R28/R9 — el unico rechazo con texto propio. Tampoco menciona la guia consultada. */
const MENSAJE_DEMASIADOS_INTENTOS =
  "Demasiadas consultas seguidas. Espera unos minutos y vuelve a intentarlo.";

/** Fallo de red o excepcion inesperada: el modal lo dice en vez de tragarselo. */
const MENSAJE_ERROR = "No se pudo consultar el envío. Vuelve a intentarlo.";

const CLASE_CAMPO =
  "h-10 w-full rounded-md border border-asfalto-2 bg-kraft-card px-3 text-sm text-asfalto-9 outline-none placeholder:text-asfalto-4 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

const CLASE_ENVIAR =
  "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60";

/**
 * La fecha que llega del servidor es ISO-8601 completa, ya en la zona del negocio y con su
 * desfase (R19/G12). Aqui SOLO se recorta el desfase para pintarla: no se re-calcula la zona
 * —eso volveria a derivar en el cliente una regla que es del servidor— y el valor completo
 * viaja intacto en el atributo `dateTime` del `<time>`.
 */
function fechaLegible(fecha: string): string {
  const corte = fecha.indexOf("T");
  if (corte < 0) return fecha;
  return `${fecha.slice(0, corte)} · ${fecha.slice(corte + 1, corte + 6)}`;
}

/**
 * Al cerrar, el `?guia=` desaparece de la barra de direcciones: el enlace sirve para ENTRAR una
 * vez, no para dejar la landing marcada. Sin él, recargar ya no vuelve a abrir el diálogo y
 * copiar la URL de una landing cerrada no comparte la guía que alguien consultó ahí.
 *
 * `history.replaceState` y NO el router: sustituye la entrada actual —no añade una atrás, así
 * que «volver» sigue saliendo de la landing— y no dispara navegación ni vuelve a pedir la
 * página. Es la misma línea que R30 sostiene: aquí la URL solo PIERDE datos, nunca gana.
 *
 * Se retira EXCLUSIVAMENTE este parámetro: cualquier otro (campañas, `utm_*`, un ancla) se
 * conserva tal cual, porque no es nuestro.
 */
function retirarGuiaDeLaUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM_GUIA)) return;
  url.searchParams.delete(PARAM_GUIA);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** El texto de rechazo que corresponde a un resultado que no es `ok`. */
function textoDeRechazo(resultado: ResultadoRastreoPublico): string | null {
  if (resultado.estado === "no_encontrado") return MENSAJE_NO_ENCONTRADO;
  if (resultado.estado === "demasiados_intentos") return MENSAJE_DEMASIADOS_INTENTOS;
  if (resultado.estado === "validation_error") {
    // Los mensajes del schema son literales FIJOS del servidor (R12): no interpolan la guia
    // ni el segundo factor, y no dicen nada sobre si el envio existe.
    const primero = Object.values(resultado.campos)[0];
    return primero ?? MENSAJE_NO_ENCONTRADO;
  }
  return null;
}

export interface RastreoDialogProps {
  /** Clase del disparador: la decide la nav, que es donde vive su aspecto. */
  className?: string;
  /** Contenido del disparador (icono + texto), tal como lo declara la nav. */
  children: ReactNode;
  /**
   * La guía que venía en la URL (`/?guia=4321`), ya normalizada por `numGuiaDeQuery`, o `null`.
   * Con ella el diálogo NACE ABIERTO y con el primer campo puesto; sin ella no cambia nada.
   * Precarga el formulario, no el resultado: el segundo factor se sigue tecleando.
   */
  guiaInicial?: string | null;
}

/**
 * El disparador «Rastrear envío» de la landing y su diálogo, en la misma isla cliente.
 *
 * La nav sigue siendo Server Component: solo monta esto y le pasa el aspecto y el texto del
 * botón, que es el patrón que la landing ya usa para sus islas (`cifras-publicas.tsx`).
 */
export function RastreoDialog({ className, children, guiaInicial = null }: RastreoDialogProps) {
  const idGuia = useId();
  const idFactor = useId();
  const refFactor = useRef<HTMLInputElement>(null);

  // Los inicializadores corren SOLO en el primer montaje, y de eso depende que la apertura por
  // URL no pelee con R30: al cerrar se limpia todo, y al reabrir el diálogo vuelve vacío aunque
  // el `?guia=` siga en la barra de direcciones. No hay efecto que lo reabra.
  const [abierto, setAbierto] = useState(() => guiaInicial !== null);
  const [numGuia, setNumGuia] = useState(() => guiaInicial ?? "");
  const [factor, setFactor] = useState("");
  const [resultado, setResultado] = useState<ResultadoRastreoPublico | null>(null);
  const [errorRed, setErrorRed] = useState(false);
  const [pendiente, iniciarConsulta] = useTransition();

  /** R30 — al cerrar se descarta TODO: no queda rastro que sobreviva a la reapertura. */
  function alCambiarApertura(siguiente: boolean) {
    setAbierto(siguiente);
    if (!siguiente) {
      setNumGuia("");
      setFactor("");
      setResultado(null);
      setErrorRed(false);
      retirarGuiaDeLaUrl();
    }
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // R27 — segunda barrera del reenvío duplicado: el botón está deshabilitado mientras la
    // consulta está en curso, y esto sigue en pie si alguien quita el `disabled`.
    if (pendiente) return;

    setResultado(null);
    setErrorRed(false);
    iniciarConsulta(async () => {
      try {
        setResultado(await consultarRastreoPublico({ numGuia, factor }));
      } catch {
        // No se registra la entrada en ningún sitio (R12): al visitante se le dice que
        // reintente, y la guía y el segundo factor no viajan a ninguna consola.
        setErrorRed(true);
      }
    });
  }

  const envio = resultado?.estado === "ok" ? resultado.envio : null;
  const rechazo = errorRed
    ? MENSAJE_ERROR
    : resultado === null
      ? null
      : textoDeRechazo(resultado);

  return (
    <Dialog open={abierto} onOpenChange={alCambiarApertura}>
      <DialogTrigger className={className}>{children}</DialogTrigger>

      {/* `tema-claro` EXPLÍCITO: el popup se portalea fuera del subárbol claro de la landing
          y sin esto el `.dark` del envoltorio del portal lo alcanzaría (R29). */}
      {/* Con guía en la URL el foco entra en el SEGUNDO campo: el primero ya viene puesto y
          empezar en él obligaría a tabular para escribir lo único que falta. Sin guía, el
          diálogo conserva su foco inicial por defecto. */}
      <DialogContent
        initialFocus={guiaInicial !== null ? refFactor : undefined}
        className="tema-claro border-asfalto-2 bg-kraft-card text-asfalto-9"
      >
        <DialogHeader>
          <DialogTitle className="text-navy-deep">Rastrear envío</DialogTitle>
          <DialogDescription className="text-asfalto-5">
            Ingresa el número de guía y los últimos 4 dígitos del teléfono del destinatario.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={alEnviar} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idGuia} className="text-asfalto-7">
              Número de guía
            </Label>
            <input
              id={idGuia}
              name="numGuia"
              inputMode="numeric"
              autoComplete="off"
              value={numGuia}
              onChange={(evento) => setNumGuia(evento.target.value)}
              className={CLASE_CAMPO}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idFactor} className="text-asfalto-7">
              Últimos 4 dígitos del teléfono
            </Label>
            <input
              ref={refFactor}
              id={idFactor}
              name="factor"
              inputMode="numeric"
              autoComplete="off"
              value={factor}
              onChange={(evento) => setFactor(evento.target.value)}
              className={CLASE_CAMPO}
            />
          </div>

          {/* R27 — el nombre accesible del control NO cambia con el estado: quien lo busca
              por su etiqueta lo sigue encontrando mientras carga. El estado de carga se
              anuncia aparte, en una región `status` que los lectores de pantalla leen. */}
          <button type="submit" disabled={pendiente} aria-busy={pendiente} className={CLASE_ENVIAR}>
            Consultar
          </button>
        </form>

        {pendiente && (
          <p role="status" className="text-sm text-asfalto-5">
            Consultando…
          </p>
        )}

        {/* R28 — un rechazo NO pinta línea de tiempo: los dos bloques son excluyentes. */}
        {rechazo !== null && (
          <p role="alert" className="rounded-md bg-kraft-inset px-3 py-2 text-sm text-asfalto-7">
            {rechazo}
          </p>
        )}

        {envio !== null && (
          // R26 — el resultado se pinta DENTRO del mismo diálogo, sin navegar.
          <div className="flex flex-col gap-3 rounded-md bg-kraft-inset p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-wide text-asfalto-5">
                Guía {envio.numGuia}
              </span>
              <span className="text-base font-semibold text-navy-deep">
                {ETIQUETA_POR_HITO[envio.hitoVigente]}
              </span>
            </div>

            <ol className="flex flex-col gap-2">
              {envio.linea.map((entrada) => (
                <li key={`${entrada.hito}-${entrada.fecha}`} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-asfalto-9">
                      {ETIQUETA_POR_HITO[entrada.hito]}
                    </span>
                    <time dateTime={entrada.fecha} className="text-xs text-asfalto-5">
                      {fechaLegible(entrada.fecha)}
                    </time>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
