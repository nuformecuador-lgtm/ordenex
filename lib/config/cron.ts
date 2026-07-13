// Feature 41 — configuracion del cron interno (corte diario). El secreto vive SIEMPRE
// en variable de entorno `CRON_SECRET`, nunca hardcodeado ni en logs (R24). Vercel Cron
// invoca el endpoint con `Authorization: Bearer <CRON_SECRET>`.

export interface CronConfig {
  /** Secreto compartido para autorizar el corte diario (R5/R24). `null` si no esta configurado. */
  CORTE_DIARIO_SECRET: string | null;
}

export function loadCronConfig(): CronConfig {
  const raw = process.env.CRON_SECRET;
  return {
    CORTE_DIARIO_SECRET: raw !== undefined && raw !== "" ? raw : null,
  };
}
