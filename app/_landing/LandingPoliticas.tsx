import { Ban, CreditCard, ShieldAlert, type LucideIcon } from "lucide-react";
import { Enfasis, RotuloSeccionOscuro, TituloSeccion } from "./primitivas";

interface Columna {
  readonly titulo: string;
  readonly Icono: LucideIcon;
  readonly puntos: readonly string[];
}

const COLUMNAS: readonly Columna[] = [
  {
    titulo: "Daños y pérdidas",
    Icono: ShieldAlert,
    puntos: [
      "Responsabilidad limitada al valor declarado del paquete.",
      "Reclamaciones dentro de 48 horas tras la entrega.",
      "Embalaje inadecuado exime de responsabilidad.",
      "Frágiles requieren embalaje especial certificado.",
    ],
  },
  {
    titulo: "Pagos y devoluciones",
    Icono: CreditCard,
    puntos: [
      "El flete se cobra al crear la orden.",
      // Ficha 301 (2026-08-28): una DEVOLUCION no cobra nada. Esta linea decia lo
      // contrario y estuvo cuatro dias en produccion diciendoselo a los clientes. El
      // unico resultado que cobra flete de retorno es `rechazada`, que es cuando el
      // paquete vuelve de verdad a la tienda; una `devuelta` es un intento fallido que
      // sigue vivo y se puede reprogramar. Ver `lib/utils/ingreso-ordenex.ts`.
      "Un paquete rechazado suma el flete de retorno; un intento fallido que se reprograma, no.",
      "Reembolsos en máximo 5 días hábiles.",
      "Paquetes no reclamados se retienen hasta 15 días hábiles.",
    ],
  },
  {
    titulo: "Artículos prohibidos",
    Icono: Ban,
    puntos: [
      "Sustancias ilegales, armas o explosivos.",
      "Dinero en efectivo o documentos de valor.",
      "Animales vivos o productos perecederos sin embalaje.",
      "Materiales peligrosos sin declaración oficial.",
    ],
  },
];

/** Bloque de políticas sobre fondo asfalto (`.lp-pol-section`), en tres columnas. */
export function LandingPoliticas() {
  return (
    <section
      id="politicas"
      className="scroll-mt-16 bg-asfalto-9 px-6 py-16 text-white md:px-12 md:py-24"
    >
      <div className="mx-auto max-w-[1200px]">
        <RotuloSeccionOscuro>Políticas</RotuloSeccionOscuro>
        <TituloSeccion className="text-white">
          <Enfasis>Transparencia</Enfasis> en cada envío.
        </TituloSeccion>

        <div className="mt-11 grid gap-8 md:grid-cols-3">
          {COLUMNAS.map((columna) => (
            <div key={columna.titulo} className="border-t border-white/15 pt-5">
              <h3 className="mb-4 flex items-center gap-2 text-[13px] font-bold tracking-[0.02em] text-brand-light uppercase">
                <columna.Icono className="size-4" aria-hidden="true" />
                {columna.titulo}
              </h3>
              <ul>
                {columna.puntos.map((punto) => (
                  <li
                    key={punto}
                    className="relative border-b border-white/10 py-2 pl-4 text-[13px] leading-snug text-asfalto-2/85"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute top-3.5 left-0 size-1.5 rounded-full bg-brand"
                    />
                    {punto}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
