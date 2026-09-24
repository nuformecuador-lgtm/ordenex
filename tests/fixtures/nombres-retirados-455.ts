/**
 * FICHA 455 — requirements §0.3: los nombres visibles RETIRADOS. Los leen las guardias G2
 * (`nombres-estado-retirados.guardia.test.ts`) y G3 (`fuente-unica-nombre-estado.guardia.test.ts`).
 * Vive en un fixture y no en una de ellas porque importar un archivo de test ejecuta sus casos.
 */
export const NOMBRES_RETIRADOS = [
  "Entregada",
  "Entregadas",
  "Devuelta",
  "Devueltas",
  "Reprogramada",
  "Reprogramadas",
  "Rechazada",
  "Rechazadas",
  "Por recoger",
  "Sin gestionar",
  "Por devolver",
  "Asignada",
  "Recolectada",
  "Por recolectar",
  "Sin recoger",
  "En gestión",
  "En detalle",
  "En ayuda",
  "En devolución",
  "Devolución por confirmar",
  "Ayuda solicitada a la tienda",
  "Ayuda de la tienda",
  "Envío registrado",
  "En nuestras instalaciones",
  "En tránsito",
  "Entrega reprogramada",
  "No fue posible entregarlo",
  "En devolución a la tienda",
  "Devuelto a la tienda",
  "En proceso",
] as const;
