"use client";

// El contador animado se volvió compartido (lo usan el portal del mensajero y los
// cierres del admin): la implementación vive en `components/shared`. Este archivo
// queda como re-export para no tocar los consumidores existentes.
export {
  KpiValorAnimado,
  type KpiValorAnimadoProps,
} from "@/components/shared/KpiValorAnimado";
