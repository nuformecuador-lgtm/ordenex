"use client";

// FICHA 456 (T2.2, design §3 DD/DE/DG) — EL BOTÓN DE INFORMACIÓN QUE EXPLICA CADA ESTADO.
//
// Es el ÚNICO archivo de `app/` y `components/` que pinta en JSX un nombre de estado, la señal de
// pendiente («<resultado> · pendiente de confirmación») o la nota de ayuda («Ayuda solicitada a la
// tienda»). Lo vigila `tests/unit/guards/estado-con-info.guardia.test.ts` (design §6): así el botón
// no puede faltar en una pantalla sin que la suite lo nombre (R18).
//
// Cinco piezas, todas sobre un `BotonInfo` interno:
//   · `InfoEstado`            → solo el botón (para ir como HERMANO de un control que ya muestra el
//                               nombre: una opción de filtro, la fila del chat; DG).
//   · `EstadoConInfo`         → nombre + botón. El nombre se calcula AQUÍ a partir del código: nadie
//                               le pasa texto. Quien necesita su chip propio (el `Badge` de
//                               `EstatusBadge`, el chip sólido de la tarjeta del mensajero) lo da con
//                               `chip`, que recibe el nombre ya resuelto.
//   · `SenalPendienteConInfo` → la señal de pendiente + botón con la explicación de «En reparto» (R11).
//   · `NotaAyudaConInfo`      → la nota de ayuda + botón con `DESCRIPCION_NOTA_AYUDA` (R12).
//   · `LeyendaEstadosConInfo` → leyenda accesible bajo una gráfica (R14): la lista de la gráfica es
//                               `aria-hidden` y no admite controles.
//
// Interacción (design §2, medida en navegador en T0.2, `progress/impl_456.md`):
//   · popover (no tooltip): se abre al pasar el puntero (200 ms) y al pulsar, tocar, Enter o Espacio,
//     y se queda abierto hasta pulsar fuera, volver a pulsar el botón o Escape (R20-R22);
//   · sin `keepMounted`: cerrado no hay nodo en el DOM (R29 y tablas de 50-500 filas);
//   · el `click` NO sube al contenedor, ni desde el botón ni desde el texto abierto (R30). El popup se
//     portalea, pero los eventos sintéticos de React suben por el árbol de React: sin el corte, un
//     toque en el texto seleccionaría la tarjeta del mensajero. Solo se corta el `click`: cortar
//     `pointerdown`/`keydown` rompería el «pulsar fuera» y el Escape de Base UI (escuchan en
//     `document`) y con ellos R21/R25;
//   · el popup lleva `data-slot="estado-info-popup"`: el filtro de estado ignora sus clics y su
//     Escape para no cerrarse (R31, design §4.4).
//
// Retirados y «Estado no reconocido» no tienen texto aprobado: se pinta el nombre de la 455 sin botón
// (R15). Presentación pura: sin fetch, sin dominio (R29).

import type { MouseEvent, ReactNode } from "react";
import { Info } from "lucide-react";

import {
  COLETILLA_PENDIENTE_CONFIRMACION,
  NOTA_AYUDA_SOLICITADA,
  textoPendienteConfirmacion,
} from "@/components/shared/nota-pendiente-confirmacion";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DESCRIPCION_ESTADO,
  DESCRIPCION_NOTA_AYUDA,
  descripcionDeEstado,
  nombreDeEstado,
  type OrderStatusValue,
} from "@/lib/types/order-status";
import { cn } from "@/lib/utils";

/** Dónde se pinta: la app (tokens que giran con el tema) o la landing pública (paleta clara fija). */
export type SuperficieInfo = "app" | "landing";

/** Marca del popup: el filtro de estado la usa para no cerrarse con sus clics ni su Escape (§4.4). */
export const SLOT_POPUP_ESTADO_INFO = "estado-info-popup";

/** Selector CSS del popup abierto. */
export const SELECTOR_POPUP_ESTADO_INFO = `[data-slot="${SLOT_POPUP_ESTADO_INFO}"]`;

/** R23 — el nombre accesible del botón. */
export function etiquetaBotonInfo(nombre: string): string {
  return `Qué significa «${nombre}»`;
}

/** Retraso del hover (R20). El clic, el toque y el teclado abren al instante. */
const RETRASO_HOVER_MS = 200;

const cortarClick = (e: MouseEvent) => e.stopPropagation();

/**
 * R26/R27/R33 — clases del botón. Caja de 16 px (no crece la fila) con un área activable de 24 × 24
 * por el pseudo-elemento `after` (que no ocupa caja). Anillo de foco OPACO `ring-ring` (el de
 * `DESIGN.md`), no el `ring-ring/50` de la deuda 324.
 */
export const CLASES_BOTON_INFO =
  "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle outline-none transition-colors after:absolute after:-inset-1 after:content-[''] focus-visible:ring-3 focus-visible:ring-ring print:hidden";

const CLASES_ICONO: Record<SuperficieInfo, string> = {
  app: "text-muted-foreground hover:text-foreground",
  landing: "text-asfalto-5 hover:text-asfalto-9",
};

const CLASES_POPUP: Record<SuperficieInfo, string> = {
  app: "",
  // R28 — la landing es clara por diseño y el popup se portalea fuera de su subárbol `tema-claro`.
  landing: "tema-claro border-asfalto-2 bg-kraft-card text-asfalto-9",
};

interface BotonInfoProps {
  /** Lo que se explica: el nombre del estado, «pendiente de confirmación» o la nota de ayuda. */
  nombre: string;
  /** La explicación (texto aprobado). */
  texto: string;
  superficie?: SuperficieInfo;
  /** Clases extra del título (p. ej. mayúscula inicial de «pendiente de confirmación»). */
  claseTitulo?: string;
}

function BotonInfo({ nombre, texto, superficie = "app", claseTitulo }: BotonInfoProps) {
  return (
    <Popover modal={false}>
      <PopoverTrigger
        openOnHover
        delay={RETRASO_HOVER_MS}
        closeDelay={100}
        aria-label={etiquetaBotonInfo(nombre)}
        className={cn(CLASES_BOTON_INFO, CLASES_ICONO[superficie])}
        onClick={cortarClick}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        data-slot={SLOT_POPUP_ESTADO_INFO}
        className={CLASES_POPUP[superficie]}
        onClick={cortarClick}
      >
        <PopoverTitle className={claseTitulo}>{nombre}</PopoverTitle>
        <PopoverDescription>{texto}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

// ─── Piezas públicas ─────────────────────────────────────────────────────────────────────────────

export interface InfoEstadoProps {
  /** Código del estado (`order_status.value`). Retirado o desconocido → no se pinta nada (R15). */
  codigo: string;
  superficie?: SuperficieInfo;
}

/** Solo el botón, para ir junto a un control que ya muestra el nombre (patrón de hermano, DG). */
export function InfoEstado({ codigo, superficie = "app" }: InfoEstadoProps) {
  const texto = descripcionDeEstado(codigo);
  if (texto === null) return null;
  return <BotonInfo nombre={nombreDeEstado(codigo)} texto={texto} superficie={superficie} />;
}

export interface EstadoConInfoProps {
  /** Código del estado. El nombre visible se calcula aquí (R7): nadie le pasa texto. */
  codigo: string;
  /** Clases del chip por defecto (un `<span>` con el nombre). */
  chipClassName?: string;
  /**
   * Chip propio de la superficie, que recibe el nombre YA resuelto (R32: mismo texto, color y
   * nombre accesible que antes de la 456). Sin él, un `<span className={chipClassName}>`.
   */
  chip?: (nombre: string) => ReactNode;
  /** Clases del envoltorio (colocación). */
  className?: string;
  superficie?: SuperficieInfo;
  /**
   * R33 — para filas donde no caben 20 px más sin partir el chip en dos líneas (la tarjeta «detalle»
   * del mensajero a 390 px, medido en `progress/recorrido_456.md`): el botón va SUPERPUESTO en la
   * esquina del chip, sin ocupar caja. Sigue siendo un botón hermano del chip (no está dentro).
   */
  botonFlotante?: boolean;
}

/** Nombre + botón, como HERMANOS en un `inline-flex` (el chip conserva su texto y su color). */
export function EstadoConInfo({
  codigo,
  chipClassName,
  chip,
  className,
  superficie = "app",
  botonFlotante = false,
}: EstadoConInfoProps) {
  const nombre = nombreDeEstado(codigo);
  if (botonFlotante) {
    return (
      <span className={cn("relative inline-flex max-w-full align-middle", className)}>
        {chip ? chip(nombre) : <span className={chipClassName}>{nombre}</span>}
        <span className="absolute -top-2 -right-2 z-10 inline-flex rounded-full bg-card">
          <InfoEstado codigo={codigo} superficie={superficie} />
        </span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      {chip ? chip(nombre) : <span className={chipClassName}>{nombre}</span>}
      <InfoEstado codigo={codigo} superficie={superficie} />
    </span>
  );
}

export interface SenalPendienteConInfoProps {
  /**
   * Resultado de la gestión pendiente de confirmar (`GestionResultado`, que ES un código de estado
   * desde la 455; el rastreo público lo obtiene con `codigoDeNombre`).
   */
  resultado: OrderStatusValue;
  /** Chip propio; recibe «<resultado> · pendiente de confirmación» ya resuelto. */
  chip?: (texto: string) => ReactNode;
  chipClassName?: string;
  className?: string;
  superficie?: SuperficieInfo;
}

/**
 * R11 — «<resultado> · pendiente de confirmación» + botón con la explicación de «En reparto», que es
 * el texto aprobado que habla de «pendiente de confirmación» (design DE). Nombre accesible (R23):
 * «Qué significa «pendiente de confirmación»».
 */
export function SenalPendienteConInfo({
  resultado,
  chip,
  chipClassName,
  className,
  superficie = "app",
}: SenalPendienteConInfoProps) {
  const texto = textoPendienteConfirmacion(nombreDeEstado(resultado));
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      {chip ? chip(texto) : <span className={chipClassName}>{texto}</span>}
      <BotonInfo
        nombre={COLETILLA_PENDIENTE_CONFIRMACION}
        texto={DESCRIPCION_ESTADO.en_reparto}
        superficie={superficie}
        claseTitulo="first-letter:uppercase"
      />
    </span>
  );
}

export interface NotaAyudaConInfoProps {
  /** Chip propio; recibe «Ayuda solicitada a la tienda». */
  chip?: (texto: string) => ReactNode;
  chipClassName?: string;
  className?: string;
}

/** R12 — la nota de ayuda + botón con `DESCRIPCION_NOTA_AYUDA` (pendiente de visto bueno, R8). */
export function NotaAyudaConInfo({ chip, chipClassName, className }: NotaAyudaConInfoProps) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      {chip ? chip(NOTA_AYUDA_SOLICITADA) : <span className={chipClassName}>{NOTA_AYUDA_SOLICITADA}</span>}
      <BotonInfo nombre={NOTA_AYUDA_SOLICITADA} texto={DESCRIPCION_NOTA_AYUDA} />
    </span>
  );
}

export interface InfosEstadoProps {
  /** Códigos (de estado o de resultado) que nombra el texto de al lado, en su orden. */
  codigos: readonly string[];
  className?: string;
}

/**
 * R10 — los botones de información de una LÍNEA DE TEXTO que nombra varios estados o resultados
 * («Entregado · Reprogramado» en el detalle de un movimiento del wallet): la línea no se parte (su
 * texto no cambia, R32) y los botones van a su lado, uno por código distinto y en el orden del texto.
 */
export function InfosEstado({ codigos, className }: InfosEstadoProps) {
  const unicos = [...new Set(codigos)];
  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      {unicos.map((codigo) => (
        <InfoEstado key={codigo} codigo={codigo} />
      ))}
    </span>
  );
}

/** Nombre accesible por defecto de la leyenda propia bajo una gráfica de estados (R14). */
export const TITULO_LEYENDA_ESTADOS = "Qué significa cada estado";

export interface LeyendaEstadosConInfoProps {
  /** Códigos de estado, en el orden de la gráfica (R37: el mismo orden que las barras). */
  codigos: readonly string[];
  /** Nombre accesible de la lista. */
  titulo: string;
  /** Clase de la muestra de color de la serie de cada código (opcional). */
  claseMuestra?: (codigo: string) => string | undefined;
  className?: string;
}

/**
 * R14 — leyenda accesible PROPIA bajo una gráfica cuyas categorías son estados: un `EstadoConInfo`
 * por código, en el orden recibido. No toca la gráfica (design §10-C).
 */
export function LeyendaEstadosConInfo({ codigos, titulo, claseMuestra, className }: LeyendaEstadosConInfoProps) {
  return (
    <ul aria-label={titulo} className={cn("flex flex-wrap gap-x-3 gap-y-1 text-xs", className)}>
      {codigos.map((codigo) => {
        const muestra = claseMuestra?.(codigo);
        return (
          <li key={codigo} className="inline-flex items-center gap-1.5">
            {muestra ? <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-sm", muestra)} /> : null}
            <EstadoConInfo codigo={codigo} />
          </li>
        );
      })}
    </ul>
  );
}
