"use client";

import { useId, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { z } from "zod";

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

/**
 * Modal de postulación de recurso (vehículo o bodega) de la landing pública.
 *
 * MAQUETA. El botón «Enviar postulación» valida y pinta la confirmación, pero NO
 * envía nada: todavía no está decidido el destino de los datos (tabla propia,
 * correo al equipo o WhatsApp). El único punto que hay que tocar cuando se
 * decida es `handleSubmit`; el resto —campos, validación, estados— ya está.
 *
 * Va en cliente porque el diálogo tiene estado; `LandingPostular` sigue siendo
 * Server Component y solo monta este trigger en dos de sus tres tarjetas.
 *
 * El contenido del diálogo se pinta en un portal, o sea FUERA del subárbol
 * `tema-claro` de `app/page.tsx`. Por eso lo vuelve a declarar: si no, el modal
 * de una landing clara por diseño saldría oscuro cuando el usuario tiene el
 * portal en tema oscuro.
 */

export type RecursoTipo = "vehiculo" | "bodega";

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
  "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark";

const formSchema = z.object({
  nombre: z.string().trim().min(1, "Escribí tu nombre"),
  telefono: z.string().trim().min(7, "Escribí un teléfono de contacto"),
  correo: z.string().trim().email("Escribí un correo válido"),
  mensaje: z.string().trim().min(1, "Contanos brevemente qué tenés"),
});

type Campo = keyof z.infer<typeof formSchema>;
type Errores = Partial<Record<Campo, string>>;

const VACIO: Record<Campo, string> = {
  nombre: "",
  telefono: "",
  correo: "",
  mensaje: "",
};

export function PostularRecursoModal({
  tipo,
  cta,
}: Readonly<{ tipo: RecursoTipo; cta: string }>) {
  const copy = COPY[tipo];
  const prefijo = `${useId()}-${tipo}`;

  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<Campo, string>>(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [enviado, setEnviado] = useState(false);

  const setCampo = (campo: Campo, valor: string) => {
    setValores((prev) => ({ ...prev, [campo]: valor }));
  };

  /** Al cerrar se devuelve el modal a su estado inicial: la próxima apertura empieza limpia. */
  const handleOpenChange = (siguiente: boolean) => {
    setAbierto(siguiente);
    if (!siguiente) {
      setValores(VACIO);
      setErrores({});
      setEnviado(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = formSchema.safeParse(valores);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrores({
        nombre: fieldErrors.nombre?.[0],
        telefono: fieldErrors.telefono?.[0],
        correo: fieldErrors.correo?.[0],
        mensaje: fieldErrors.mensaje?.[0],
      });
      return;
    }
    setErrores({});
    // TODO: aquí va el envío real cuando se decida el destino de la postulación.
    setEnviado(true);
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
            <DialogDescription>
              Recibimos tus datos. Nuestro equipo te contacta al teléfono o al correo
              que dejaste.
            </DialogDescription>
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

              <button type="submit" className={`${CLASE_ENVIAR} mt-1`}>
                Enviar postulación
              </button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
