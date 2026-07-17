import { cn } from "@/lib/utils";

interface LogoProps {
  /** Clases adicionales para ajustar tamaño/color según el contexto (navy vs claro). */
  className?: string;
}

/**
 * Wordmark textual de Ordenex, promovido a componente compartido (feature 86, R6).
 * Encapsula el estilo del wordmark ya presente en login/postulación/recuperación
 * (`font-heading text-2xl font-semibold tracking-tight`). Presentación pura,
 * server-compatible; sin dependencias de datos.
 */
export function Logo({ className }: Readonly<LogoProps>) {
  return (
    <span
      className={cn(
        "font-heading text-2xl font-semibold tracking-tight",
        className,
      )}
    >
      Ordenex
    </span>
  );
}
