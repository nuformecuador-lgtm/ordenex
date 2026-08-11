import { Enfasis, RotuloSeccion, Seccion, TituloSeccion } from "./primitivas";

const PASOS = [
  {
    sello: "01",
    titulo: "Crear orden",
    descripcion: "Datos del destinatario, dirección y peso del paquete desde tu panel.",
  },
  {
    sello: "02",
    titulo: "Cotizar flete",
    descripcion: "El sistema calcula el costo según zona y peso al instante.",
  },
  {
    sello: "03",
    titulo: "Recolectar",
    descripcion: "Mensajero recoge en tu dirección o lo dejás en bodega.",
  },
  {
    sello: "04",
    titulo: "Entregar",
    descripcion: "Confirmación digital. Vos ves todo en tiempo real.",
  },
] as const;

/**
 * Los cuatro pasos del flujo (`.lp-flow`). La línea que los une (`.lp-flow-track`)
 * solo aparece a partir de `md`, igual que en el sitio, y los sellos la tapan con
 * un anillo del color del lienzo. El último sello va en naranja.
 */
export function LandingComoFunciona() {
  return (
    <Seccion id="como-funciona">
      <RotuloSeccion>Cómo funciona</RotuloSeccion>
      <TituloSeccion>
        Enviar es <Enfasis>más fácil</Enfasis> de lo que crees.
      </TituloSeccion>

      <div className="relative mt-11">
        <div
          aria-hidden="true"
          className="absolute top-7 right-7 left-7 hidden h-0.5 bg-asfalto-2 md:block"
        />
        <ol className="relative grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {PASOS.map((paso, indice) => (
            <li key={paso.sello} className="flex flex-col items-start gap-3">
              <span
                className={`relative z-10 grid size-14 place-items-center rounded-full font-mono text-xl font-bold text-white ring-6 ring-kraft-canvas tabular-nums ${
                  indice === PASOS.length - 1 ? "bg-brand" : "bg-ink-blue"
                }`}
              >
                {paso.sello}
              </span>
              <h3 className="font-heading text-base leading-tight font-semibold tracking-[-0.018em] text-asfalto-9">
                {paso.titulo}
              </h3>
              <p className="text-[13px] leading-relaxed text-asfalto-5">
                {paso.descripcion}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </Seccion>
  );
}
