---
titulo: Wallet · Mensajeros
modulo: wallet
pantalla: /wallet/mensajeros, /wallet/mensajeros/[mensajeroId]
roles: [maestro, admin]
actualizado: 2026-10-01
fuentes:
  - app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx
  - app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts
  - app/(app)/wallet/mensajeros/[mensajeroId]/page.tsx
  - app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero.tsx
  - app/(app)/wallet/mensajeros/_components/estado-cuenta-mensajero-labels.ts
  - app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx
  - app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx
  - app/(app)/wallet/mensajeros/_components/PremiosRankingPanel.tsx
  - components/shared/estado-cuenta/EstadoCuenta.tsx
  - components/shared/estado-cuenta/estado-cuenta-descarga-columnas.ts
  - components/shared/estado-cuenta/estado-cuenta-labels.ts
  - components/shared/wallet/zonas-filtros-labels.ts
  - components/shared/estado-cuenta/SelectorCierreDeCuenta.tsx
  - app/(app)/wallet/_components/DetalleMovimientoCierre.tsx
  - app/(app)/wallet/_components/ordenes-de-fila-cuenta.ts
  - app/(app)/wallet/_components/detalle-movimiento-labels.ts
  - lib/actions/estado-cuenta.ts
  - components/shared/wallet/DetalleMovimientoPanel.tsx
  - lib/actions/wallet-anulacion.ts
  - lib/services/EstadoCuentaService.ts
  - lib/repositories/EstadoCuentaRepository.ts
  - lib/utils/estado-cuenta-chips.ts
---

# Wallet · Mensajeros

**Lo que hay que pagarle a cada mensajero.** Es la pantalla de la nómina del reparto.

## Cuentas por pagar

Una fila por mensajero con lo que se le debe. Se busca por nombre y está paginada, así que con muchos
mensajeros no hace falta desplazarse hasta el final. Cada fila lleva **Ver estado de cuenta**.

## El estado de cuenta de un mensajero

Abre la cuenta del mensajero en su propia página: **de dónde sale cada colón**, como un extracto.

Arriba, el **saldo actual** con la frase «Ordenex le debe ₡… a Juan Pérez Mora», y las cifras del
periodo: **Saldo inicial**, **Abonos del periodo** (lo que Ordenex le debe por sus cierres aprobados y
sus premios), **Cargos del periodo** (lo que ya se le pagó o descontó) y **Saldo al final del periodo**.
Acá las cifras ya **no cuentan los pagos anulados**: un pago y su anulación se cancelan entre ellos.

El extracto se abre en **Más recientes** (el último movimiento arriba) y se puede pasar a **Más
antiguas**. La línea del **saldo inicial** va donde cae en el tiempo: con **Más recientes**, la última
línea de la última página; con **Más antiguas**, la primera de la primera página. Cada
movimiento lleva su fecha, su concepto, el motivo, **de dónde viene** con nombre («Cierre del día ·
2026-09-12 · Juan Pérez Mora», con un enlace **Ver** al cierre), **cómo se pagó** si es un pago (método y
referencia), **quién lo registró** y el **saldo** del mensajero justo después.

Los filtros están en **dos zonas**. Arriba, antes de las cifras, **«Estos filtros cambian toda la
wallet»**: el **Periodo** (días de Costa Rica), que se elige en el calendario y se aplica con
**Aplicar**; **Quitar periodo** lo quita. Encima de la tabla, **«Estos filtros solo afectan al libro de
movimientos»** —no cambian las cifras de arriba—: un **buscador** (descripción y quién registró, al
menos 3 caracteres), el orden **Más recientes / Más antiguas**, los chips
**Todo · Cierres · Pagos · Premios · Correcciones** y el filtro
por **cierre**: un selector con búsqueda que solo ofrece los cierres con movimientos de este mensajero,
cada uno con su día; se busca por un día o por el nombre. Al elegir un cierre se ven sus filas **y los
pagos registrados contra ese cierre, con sus anulaciones**; el número de movimientos del selector ya
los cuenta. El saldo de cada fila es siempre el de la cuenta entera, en cualquier orden. **Limpiar
todo** quita el texto buscado, el chip y el cierre, sin tocar el orden ni el periodo. Si una lectura
falla, la pantalla lo dice y se queda con lo que mostraba, filtros incluidos.

Las filas que vienen de un cierre tienen una flecha al principio. Al abrirla, el pago de un cierre **no
se reparte orden por orden**: es el total que ese cierre dejó anotado para pagarle al mensajero, y el
detalle lo dice así. Para ver sus órdenes, abrí el cierre con el enlace **Ver** de la fila.

Es el nivel donde se contesta *«¿por qué me pagaron esto?»* sin discutir de memoria. Se puede
**descargar** el periodo entero (con el texto buscado, el chip, el cierre y el orden elegidos, y el saldo
inicial donde cae en el tiempo), con el saldo de cada fila; si hay más
movimientos de los que entran en una descarga, no se descarga nada y te lo dice.

## Pagarle al mensajero

**Ordenex le paga al mensajero**, en las acciones de su estado de cuenta, abre el pago con la
**previsualización del reparto**, para ver a qué cierres se aplica antes de confirmarlo — no después.
Al registrar, su estado de cuenta se actualiza solo.

## Anular un pago

Un pago registrado por error se anula **desde su estado de cuenta**: **Ver** en la fila del pago y luego
**Anular…**, con el motivo. Es **la misma anulación que la de Cierres**: el pago vuelve a quedar por
pagar y la fila queda tachada con quién lo anuló, cuándo y por qué. En **Cierres** se sigue pudiendo
anular igual.

## Premios del ranking

El panel de premios conecta con el **Ranking**: lo que se define ahí como premio aparece acá como algo
a pagar. Un premio no es un número suelto — termina en la cuenta del mensajero, con el chip **Premios**.

## Cosas que te pueden pasar

**«No hay cuentas por pagar».** Nadie tiene saldo pendiente. Después de una ronda de pagos es lo
normal.

**«No se pudo cargar el estado de cuenta».** Falló una lectura; la pantalla se queda con lo último que
cargó —cifras, extracto y filtros— y lo dice encima del extracto. Probá de nuevo.

**Un mensajero con saldo menor del que esperaba.** Los pagos entran **cuando se aprueba su cierre**, no
cuando entrega. Si tiene cierres sin aprobar, ese trabajo todavía no está contado.

## Lo que esta pantalla NO hace

- **No se aprueban cierres acá.** Eso es **Cierres**. Sin cierre aprobado no hay nada que pagar.
- **No se definen las tarifas.** Cuánto se paga por entrega se configura en **Configuración · Tarifas**.
