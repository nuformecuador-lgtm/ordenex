import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ListarOrderStatusResult } from "@/lib/types/order-status";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// FICHA 355 — el catálogo `order_status` tal como lo devuelve `listarOrderStatus()`, para las
// suites de COMPONENTE que montan un desplegable de estado.
//
// Existe porque desde esta ficha el filtro de estado de la bodega satélite sale del catálogo
// compartido (antes eran cinco opciones escritas a mano en el propio módulo), así que sus
// suites tienen que doblar la Server Action igual que ya lo hacían las de `/ordenes`.
//
// Por qué NO se reusa `filasCatalogoEstados` (`tests/fixtures/catalogo-estados.ts`), que
// produce exactamente estas mismas filas: aquel módulo importa `registrar-cambio-estado`, y
// con él media capa de servicios (webhooks, notificaciones, transiciones). En una suite jsdom
// eso arrastra el grafo del servidor al navegador para conseguir 22 pares `{id, value}`. El
// esquema de ids es EL MISMO (`os-<value>`) a propósito: si alguna suite cruza los dos, cruzan.

/** Filas del catálogo, una por cada `value` del seed y en su MISMO orden (R5: determinista). */
export function catalogoOrderStatus(): OrderStatusLiteRow[] {
  return ORDER_STATUS_SEED.map((value) => ({ id: `os-${value}`, value }));
}

/** La respuesta `ok` de `listarOrderStatus()` con el catálogo completo. */
export function listarOrderStatusOk(): ListarOrderStatusResult {
  return { status: "ok", estatus: catalogoOrderStatus() };
}
