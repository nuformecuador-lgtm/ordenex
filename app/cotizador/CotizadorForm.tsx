"use client";

import { useState, useTransition, type FormEvent } from "react";

import { FormField } from "@/components/shared/FormField";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { consultarCoberturaPublica } from "@/lib/actions/cobertura-publica";
import type {
  ArbolGeograficoPublico,
  ResultadoCoberturaPublica,
} from "@/lib/types/cotizador";

// Feature 248 (T4.1/T4.2, design §4.1 y D3/D13) — la cascada publica de cobertura por distrito.
//
// Vive junto a la pagina y no en `components/shared/`: se monta en UN SOLO sitio y no tiene
// logica reutilizable (`docs/architecture.md`, «sin sobre-ingenieria»). Se promovera el dia que
// una segunda superficie lo necesite, igual que se decidio con `RastreoDialog` (feature 229).
//
// TRES COSAS QUE ESTE ARCHIVO SOSTIENE:
//
//  1. **R11 — EL COPY DE COMPENSACION NO ES DECORACION.** El humano acepto el nombre
//     `/cotizador` sabiendo que PROMETE MAS DE LO QUE ESTA SUPERFICIE DA: aqui no hay ni un
//     importe, porque sin tienda no hay tarifa (decision (b) de la ficha). La compensacion del
//     riesgo aceptado es este texto, y va **en el render inicial** —no detras de un click, no en
//     un acordeon cerrado, no en un tooltip— porque un aviso que hay que descubrir no compensa
//     nada. Un test lo afirma.
//  2. **⛔ NI UN IMPORTE, NI DERIVABLE POR DIFERENCIA (R6/R10).** No hay monto, ni porcentaje,
//     ni total, ni campo del que se pueda despejar uno; y no hay ARITMETICA MONETARIA EN EL
//     NAVEGADOR. El repo ya pago ese error: `lib/utils/ingreso-ordenex.ts:121-146` documenta con
//     casos medidos que reimplementar las formulas en el cliente desviaba un centimo en 14 de 66
//     ordenes reales. Aqui el grafo de imports ni siquiera llega al dinero, y una guardia
//     estatica lo mide.
//  3. **⛔ NADA DE ZONA MAS ALLA DEL NOMBRE (R7).** El arbol que llega por props no trae `zona`
//     ni `esCentral`, y el resultado de la accion es el DTO publico: `esCentral` y los ids de
//     zona/tarifa/tienda no existen en el tipo, asi que no hay nada que «acordarse de quitar».
//
// Y lo que este componente NO hace: no valida la geografia por su cuenta. La cascada solo ofrece
// combinaciones existentes, pero quien decide si un trio resuelve es el servidor (R5) — el
// formulario se puede enviar incompleto a proposito, y entonces pinta los errores POR CAMPO que
// devuelve la Server Action.

/** Textos de la superficie, aislados del JSX y listos para i18n (docs/conventions.md). */
const TEXTOS = {
  titulo: "Consultá la cobertura de un distrito",
  /**
   * R11/D3 — la compensacion del riesgo aceptado, palabra por palabra. Si alguien recorta este
   * parrafo, la pagina vuelve a prometer un precio que nunca va a dar.
   */
  compensacion:
    "Acá se consulta cobertura: si Ordenex entrega en ese distrito y en qué zona queda. Esta página no muestra ningún importe. El costeo del envío se obtiene por el canal de integración con API key, que es el único que conoce la tarifa de tu tienda.",
  compensacionEnlace: "Ver la documentación del canal con API key",
  provincia: "Provincia",
  canton: "Cantón",
  distrito: "Distrito",
  placeholderProvincia: "Elegí una provincia",
  placeholderCanton: "Elegí un cantón",
  placeholderDistrito: "Elegí un distrito",
  consultar: "Consultar cobertura",
  consultando: "Consultando…",
  tituloCubierto: "Hay cobertura en este distrito",
  zona: "Zona de cobertura",
  tituloSinCobertura: "Todavía no hay cobertura en este distrito",
  detalleSinCobertura:
    "Ese distrito no está asignado a ninguna zona de cobertura. Escribinos si necesitás entregar ahí.",
  tituloNoDeterminado: "No podemos confirmar la cobertura de este distrito",
  detalleNoDeterminado:
    "Los datos de ese distrito no permiten determinar una zona única. Escribinos y lo revisamos.",
  tituloError: "No se pudo consultar la cobertura",
  detalleError: "Volvé a intentarlo en unos segundos.",
} as const;

export interface CotizadorFormProps {
  /**
   * D13 — el catalogo entero, leido por el Server Component y pasado por props. Sin zonas
   * (R7) y ya ordenado alfabeticamente en los tres niveles por el repositorio: la UI no ordena.
   */
  arbol: ArbolGeograficoPublico;
}

const aOpciones = (
  items: readonly { readonly id: string; readonly nombre: string }[],
): SelectOption[] => items.map((item) => ({ value: item.id, label: item.nombre }));

export function CotizadorForm({ arbol }: Readonly<CotizadorFormProps>) {
  const [provinciaId, setProvinciaId] = useState("");
  const [cantonId, setCantonId] = useState("");
  const [distritoId, setDistritoId] = useState("");
  const [resultado, setResultado] = useState<ResultadoCoberturaPublica | null>(null);
  const [errorRed, setErrorRed] = useState(false);
  const [pendiente, iniciarConsulta] = useTransition();

  // R9 — LA CASCADA SE DERIVA DEL ARBOL, NO SE GUARDA EN ESTADO. Los cantones ofrecidos son los
  // de la provincia elegida y los distritos los del canton elegido; con la seleccion vacia no
  // hay nada que ofrecer. Derivar en vez de sincronizar evita el estado que se queda viejo.
  const provincia = arbol.find((p) => p.id === provinciaId);
  const canton = provincia?.cantones.find((c) => c.id === cantonId);
  const cantones = provincia?.cantones ?? [];
  const distritos = canton?.distritos ?? [];

  /** Cambiar de provincia invalida canton Y distrito; cambiar de canton invalida el distrito. */
  function elegirProvincia(siguiente: string) {
    setProvinciaId(siguiente);
    setCantonId("");
    setDistritoId("");
    setResultado(null);
    setErrorRed(false);
  }

  function elegirCanton(siguiente: string) {
    setCantonId(siguiente);
    setDistritoId("");
    setResultado(null);
    setErrorRed(false);
  }

  function elegirDistrito(siguiente: string) {
    setDistritoId(siguiente);
    setResultado(null);
    setErrorRed(false);
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // Segunda barrera del reenvio duplicado: sigue en pie si alguien quita el `disabled`.
    if (pendiente) return;

    setResultado(null);
    setErrorRed(false);
    iniciarConsulta(async () => {
      try {
        // D1 — la entrada es el TRIO DE NOMBRES, el mismo con el que la carga por API key
        // identifica la geografia: se cotiza con lo mismo con lo que despues se carga. Los ids
        // se quedan en el navegador, como detalle de la cascada.
        setResultado(
          await consultarCoberturaPublica({
            provincia: provincia?.nombre ?? "",
            canton: canton?.nombre ?? "",
            distrito: distritos.find((d) => d.id === distritoId)?.nombre ?? "",
          }),
        );
      } catch {
        setErrorRed(true);
      }
    });
  }

  const campos = resultado?.estado === "validation_error" ? resultado.campos : {};

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{TEXTOS.titulo}</h1>
        {/* R11/D3 — render inicial, sin click de por medio y sin depender de ninguna animacion
            (esta maquina pide `prefers-reduced-motion: reduce`, y el aviso se lee igual). */}
        <p className="text-sm leading-relaxed text-muted-foreground">{TEXTOS.compensacion}</p>
        <a
          href="/api-docs"
          className="w-fit rounded-md text-sm font-medium text-brand underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TEXTOS.compensacionEnlace}
        </a>
      </header>

      <form onSubmit={alEnviar} className="flex flex-col gap-4" noValidate>
        <FormField id="cotizador-provincia" label={TEXTOS.provincia} error={campos.provincia}>
          {(control) => (
            <Select
              {...control}
              value={provinciaId}
              onValueChange={elegirProvincia}
              options={aOpciones(arbol)}
              placeholder={TEXTOS.placeholderProvincia}
              aria-label={TEXTOS.provincia}
              disabled={pendiente}
            />
          )}
        </FormField>

        <FormField id="cotizador-canton" label={TEXTOS.canton} error={campos.canton}>
          {(control) => (
            <Select
              {...control}
              value={cantonId}
              onValueChange={elegirCanton}
              options={aOpciones(cantones)}
              placeholder={TEXTOS.placeholderCanton}
              aria-label={TEXTOS.canton}
              // Sin provincia no hay canton que ofrecer: el control deshabilitado dice el orden
              // de la cascada sin necesidad de un mensaje.
              disabled={pendiente || provincia === undefined}
            />
          )}
        </FormField>

        <FormField id="cotizador-distrito" label={TEXTOS.distrito} error={campos.distrito}>
          {(control) => (
            <Select
              {...control}
              value={distritoId}
              onValueChange={elegirDistrito}
              options={aOpciones(distritos)}
              placeholder={TEXTOS.placeholderDistrito}
              aria-label={TEXTOS.distrito}
              disabled={pendiente || canton === undefined}
            />
          )}
        </FormField>

        {/* El nombre accesible del boton NO cambia con el estado: quien lo busca por su etiqueta
            lo sigue encontrando mientras carga. El progreso se anuncia aparte, en una region
            `status`. Y NO se deshabilita por falta de seleccion: enviar incompleto tiene que
            poder llegar al servidor, que es quien decide si el trio resuelve (R5). */}
        <Button type="submit" disabled={pendiente} aria-busy={pendiente} className="w-fit">
          {TEXTOS.consultar}
        </Button>
      </form>

      {pendiente && (
        <p role="status" className="text-sm text-muted-foreground">
          {TEXTOS.consultando}
        </p>
      )}

      {/* Los cuatro estados del DTO publico, mas el fallo de red. Ninguno pinta un importe. */}
      {errorRed && (
        <Alert variant="destructive">
          <AlertTitle>{TEXTOS.tituloError}</AlertTitle>
          <AlertDescription>{TEXTOS.detalleError}</AlertDescription>
        </Alert>
      )}

      {resultado?.estado === "cubierto" && (
        <Alert>
          <AlertTitle>{TEXTOS.tituloCubierto}</AlertTitle>
          <AlertDescription>
            {/* R7 — el NOMBRE de la zona y nada mas: ni `esCentral`, ni ids, ni tarifa. */}
            {TEXTOS.zona}: {resultado.zonaNombre}
          </AlertDescription>
        </Alert>
      )}

      {resultado?.estado === "sin_cobertura" && (
        <Alert>
          <AlertTitle>{TEXTOS.tituloSinCobertura}</AlertTitle>
          <AlertDescription>{TEXTOS.detalleSinCobertura}</AlertDescription>
        </Alert>
      )}

      {resultado?.estado === "no_determinado" && (
        <Alert>
          <AlertTitle>{TEXTOS.tituloNoDeterminado}</AlertTitle>
          <AlertDescription>{TEXTOS.detalleNoDeterminado}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
