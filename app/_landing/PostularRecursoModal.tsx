"use client";

import { useId, useState, useTransition } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { postularRecurso } from "@/lib/actions/postulacion-recurso";
import {
  postulacionRecursoSchema,
  type PostularRecursoResult,
  type RecursoTipo,
} from "@/lib/types/postulacion-recurso";

/**
 * Modal de postulación de recurso (vehículo o bodega) de la landing pública.
 *
 * Feature 253 (T6.1) — ESTE ARCHIVO DEJÓ DE SER UNA MAQUETA, y conviene saber de qué venía.
 * Hasta esta ficha, `handleSubmit` validaba y hacía `setEnviado(true)` con un `// TODO`: la
 * pantalla daba acuse de recibo de algo que NO ocurría, en producción, a personas que no tenían
 * ninguna otra forma de enterarse. Ahora llama a la Server Action pública `postularRecurso`, que
 * escribe la fila, y **el acuse sólo se pinta tras un `ok`** (R1).
 *
 * Tres cosas que este archivo sostiene y que no hay que deshacer por descuido:
 *
 *  1. **NINGÚN DESENLACE ES MUDO (R2).** Todo lo que no sea `ok` —validación, límite de tasa,
 *     fallo del servidor o una promesa rechazada— termina pintando un aviso EN PANTALLA, y lo que
 *     la persona escribió se queda en los campos. Es la lección literal de las fichas 248 y 240
 *     (§9.6): sin el `try/catch`, la promesa rechazada se pierde dentro de la transición, la
 *     persona ve la pantalla rota y pierde todo lo que escribió.
 *  2. **EL MAPA DE TEXTOS ESTÁ TIPADO (R5).** `TEXTO_POR_FALLO` es un
 *     `Record<Exclude<PostularRecursoResult["status"], "ok">, string>`: si mañana la acción gana un
 *     desenlace nuevo, **el typecheck se rompe** hasta que alguien le escriba su texto. Un mensaje
 *     equivocado es peor que ninguno, así que el desenlace nuevo no se disfraza de uno existente.
 *  3. **EL SCHEMA ES EL DEL SERVIDOR (R14).** `postulacionRecursoSchema` vive en `lib/types/` y lo
 *     validan cliente y servidor. La validación de aquí es una cortesía —ahorra un viaje— y no una
 *     garantía: el servidor revalida el objeto entero.
 *
 * Va en cliente porque el diálogo tiene estado; `LandingPostular` sigue siendo
 * Server Component y solo monta este trigger en dos de sus tres tarjetas.
 *
 * El contenido del diálogo se pinta en un portal, o sea FUERA del subárbol
 * `tema-claro` de `app/page.tsx`. Por eso lo vuelve a declarar: si no, el modal
 * de una landing clara por diseño saldría oscuro cuando el usuario tiene el
 * portal en tema oscuro.
 */

export type { RecursoTipo };

interface Copy {
  readonly titulo: string;
  readonly descripcion: string;
  readonly labelMensaje: string;
  readonly placeholderMensaje: string;
}

const COPY: Record<RecursoTipo, Copy> = {
  vehiculo: {
    titulo: "Postular mi vehículo",
    descripcion:
      "Dejanos tus datos y contanos qué vehículo tenés. Nuestro equipo te contacta.",
    labelMensaje: "Contanos sobre tu vehículo",
    placeholderMensaje:
      "Tipo de vehículo, año, capacidad de carga, en qué ciudad está y con qué disponibilidad.",
  },
  bodega: {
    titulo: "Postular mi bodega",
    descripcion:
      "Dejanos tus datos y contanos qué espacio tenés. Nuestro equipo te contacta.",
    labelMensaje: "Contanos sobre tu bodega",
    placeholderMensaje:
      "Metros disponibles, ubicación, si tiene muelle o seguridad y desde cuándo está libre.",
  },
};

/** Mismas clases que el CTA que había antes como `<Link>`, para no mover el diseño. */
const CLASE_CTA =
  "mt-1 inline-flex items-center gap-1.5 self-start rounded-md border border-brand bg-brand px-3.5 py-2.5 text-[13px] font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark";

const CLASE_ENVIAR =
  "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark disabled:cursor-not-allowed disabled:opacity-60";

/**
 * D9 FIRMADA — el acuse dice lo que DE VERDAD pasó: la postulación quedó registrada. No promete
 * ningún plazo (R6).
 *
 * El texto anterior —«Recibimos tus datos…»— pasa a ser cierto por primera vez con esta ficha; se
 * cambia igualmente **para que el commit muestre que la frase se revisó**.
 */
const TEXTO_ACUSE =
  "Recibimos tu postulación. Queda registrada y nuestro equipo te contacta al teléfono o al correo que dejaste.";

/**
 * R5 — un texto propio POR DESENLACE, y el tipo lo obliga.
 *
 * `Record<Exclude<PostularRecursoResult["status"], "ok">, string>`: añadir un desenlace a
 * `PostularRecursoResult` sin escribirle su texto **no compila**. Es el mecanismo que la 240 usó a
 * propósito (`progress/impl_240.md` §9.3).
 *
 * R17 — `rate_limited` tiene texto PROPIO, distinto del error genérico: a quien le dicen «hubo un
 * problema» reintenta y vuelve a chocar; a quien le dicen «esperá unos minutos», no.
 */
const TEXTO_POR_FALLO: Record<Exclude<PostularRecursoResult["status"], "ok">, string> = {
  validation_error:
    "Revisá los campos marcados: hay algo que todavía no podemos aceptar. Lo que escribiste sigue acá.",
  rate_limited:
    "Ya recibimos varias postulaciones desde este dispositivo. Esperá unos minutos y volvé a intentarlo.",
  error:
    "No pudimos registrar tu postulación. Volvé a intentarlo en unos minutos; lo que escribiste sigue acá.",
};

/**
 * Lo que se dice cuando la promesa se rompe: red caída, transporte que ni siquiera llega como
 * respuesta, o cualquier excepción inesperada.
 *
 * Va APARTE del mapa a propósito: no es un `status` de la acción —la acción nunca lanza— sino el
 * suelo del `try/catch`. Mezclarlo con `error` haría creer que el servidor contestó algo.
 */
const TEXTO_ENVIO_INTERRUMPIDO =
  "No se pudo enviar la postulación. Revisá tu conexión y volvé a intentarlo; lo que escribiste sigue acá.";

type Campo = "nombre" | "telefono" | "correo" | "mensaje";
type Errores = Partial<Record<Campo, string>>;

const CAMPOS: readonly Campo[] = ["nombre", "telefono", "correo", "mensaje"];

const VACIO: Record<Campo, string> = {
  nombre: "",
  telefono: "",
  correo: "",
  mensaje: "",
};

/**
 * R15 — los errores por campo del servidor (o de zod aquí mismo) se colocan EN SU CAMPO, para que
 * la pantalla pueda señalar al culpable.
 *
 * Sólo se recogen los cuatro campos que el formulario pinta. `tipo` no tiene control visible —lo
 * fija la tarjeta de la landing (P5)—, así que un error suyo no tendría dónde aparecer: para eso
 * está el aviso general, que se pinta SIEMPRE que hay un `validation_error`.
 */
function erroresDeCampo(fieldErrors: Record<string, string[] | undefined>): Errores {
  const salida: Errores = {};
  for (const campo of CAMPOS) {
    const mensaje = fieldErrors[campo]?.[0];
    if (mensaje) salida[campo] = mensaje;
  }
  return salida;
}

export function PostularRecursoModal({
  tipo,
  cta,
}: Readonly<{ tipo: RecursoTipo; cta: string }>) {
  const copy = COPY[tipo];
  const prefijo = `${useId()}-${tipo}`;

  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<Campo, string>>(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, iniciarEnvio] = useTransition();

  const setCampo = (campo: Campo, valor: string) => {
    setValores((prev) => ({ ...prev, [campo]: valor }));
  };

  /** Al cerrar se devuelve el modal a su estado inicial: la próxima apertura empieza limpia. */
  const handleOpenChange = (siguiente: boolean) => {
    setAbierto(siguiente);
    if (!siguiente) {
      setValores(VACIO);
      setErrores({});
      setErrorGeneral(null);
      setEnviado(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // R3, primera barrera: el botón ya está `disabled` mientras hay un envío en curso, y esto
    // sigue en pie si alguien le quita el atributo.
    if (enviando) return;

    // `tipo` viaja con el resto: hasta esta ficha era una prop que sólo elegía el copy y no
    // llegaba a ninguna parte.
    const parsed = postulacionRecursoSchema.safeParse({ ...valores, tipo });
    if (!parsed.success) {
      setErrores(erroresDeCampo(parsed.error.flatten().fieldErrors));
      setErrorGeneral(null);
      return;
    }
    setErrores({});
    setErrorGeneral(null);

    iniciarEnvio(async () => {
      try {
        // ⭑ EL ENVÍO REAL. `parsed.data` va ya normalizado por el mismo schema que el servidor
        // revalida (R14/R20): recortado, y el correo en minúsculas.
        const resultado = await postularRecurso(parsed.data);

        switch (resultado.status) {
          case "ok":
            // R1: el acuse se pinta AQUÍ y en ningún otro sitio — sólo cuando la fila existe.
            setEnviado(true);
            break;
          case "validation_error":
            // R2/R15: el campo culpable se señala y NADA se limpia.
            setErrores(erroresDeCampo(resultado.fieldErrors));
            setErrorGeneral(TEXTO_POR_FALLO.validation_error);
            break;
          case "rate_limited":
            setErrorGeneral(TEXTO_POR_FALLO.rate_limited);
            break;
          case "error":
            setErrorGeneral(TEXTO_POR_FALLO.error);
            break;
          default: {
            // Si mañana la acción gana un desenlace nuevo, ESTA línea rompe el typecheck y obliga
            // a escribirle su texto. En ejecución, el suelo: avisa, no calla.
            const _exhaustivo: never = resultado;
            setErrorGeneral(TEXTO_ENVIO_INTERRUMPIDO);
            void _exhaustivo;
            break;
          }
        }
      } catch {
        // R2 — sin este `catch` la promesa rechazada se pierde dentro de la transición y la
        // persona se queda mirando un formulario que no responde (fichas 248 y 240 §9.6).
        setErrorGeneral(TEXTO_ENVIO_INTERRUMPIDO);
      }
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={handleOpenChange}>
      <DialogTrigger className={CLASE_CTA}>
        {cta}
        <ArrowRight className="size-4" aria-hidden="true" />
      </DialogTrigger>

      <DialogContent className="tema-claro max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {enviado ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-brand" aria-hidden="true" />
            <DialogTitle className="text-lg">Postulación enviada</DialogTitle>
            <DialogDescription>{TEXTO_ACUSE}</DialogDescription>
            <DialogClose className={`${CLASE_ENVIAR} mt-2 max-w-[200px]`}>
              Cerrar
            </DialogClose>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">{copy.titulo}</DialogTitle>
              <DialogDescription>{copy.descripcion}</DialogDescription>
            </DialogHeader>

            {/*
              noValidate: la validación HTML5 nativa cortaría el submit antes de la
              nuestra y mostraría tooltips del navegador en vez de los errores
              accesibles que pinta FormField.
            */}
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
              <FormField
                id={`${prefijo}-nombre`}
                label="Nombre"
                required
                error={errores.nombre}
              >
                <Input
                  type="text"
                  autoComplete="name"
                  className="h-10"
                  value={valores.nombre}
                  onChange={(e) => setCampo("nombre", e.target.value)}
                />
              </FormField>

              <FormField
                id={`${prefijo}-telefono`}
                label="Teléfono"
                required
                error={errores.telefono}
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="h-10"
                  value={valores.telefono}
                  onChange={(e) => setCampo("telefono", e.target.value)}
                />
              </FormField>

              <FormField
                id={`${prefijo}-correo`}
                label="Correo"
                required
                error={errores.correo}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="tu@correo.com"
                  className="h-10"
                  value={valores.correo}
                  onChange={(e) => setCampo("correo", e.target.value)}
                />
              </FormField>

              <FormField
                id={`${prefijo}-mensaje`}
                label={copy.labelMensaje}
                required
                error={errores.mensaje}
              >
                <Textarea
                  rows={4}
                  placeholder={copy.placeholderMensaje}
                  value={valores.mensaje}
                  onChange={(e) => setCampo("mensaje", e.target.value)}
                />
              </FormField>

              {/*
                R2 — el aviso vive DENTRO del formulario, encima del botón, y con `role="alert"`
                para que un lector de pantalla lo anuncie sin tener que ir a buscarlo. No sustituye
                a los errores por campo: los acompaña.
              */}
              {errorGeneral ? (
                <p
                  role="alert"
                  data-testid="postular-recurso-aviso"
                  className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger-strong"
                >
                  {errorGeneral}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={enviando}
                aria-busy={enviando}
                className={`${CLASE_ENVIAR} mt-1`}
              >
                {enviando ? "Enviando…" : "Enviar postulación"}
              </button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
