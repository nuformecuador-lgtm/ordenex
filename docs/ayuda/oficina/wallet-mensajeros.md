---
titulo: Wallet · Mensajeros
modulo: wallet
pantalla: /wallet/mensajeros
roles: [maestro, admin]
actualizado: 2026-09-26
fuentes:
  - app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx
  - app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts
  - components/shared/SelectorBuscable.tsx
  - components/shared/wallet/cierres-selector.ts
  - components/shared/wallet/OrigenMovimiento.tsx
  - lib/services/OrigenLegibleService.ts
  - app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx
  - app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx
  - app/(app)/wallet/mensajeros/_components/PremiosRankingPanel.tsx
  - app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx
---

# Wallet · Mensajeros

**Lo que hay que pagarle a cada mensajero.** Es la pantalla de la nómina del reparto.

## Cuentas por pagar

Una fila por mensajero con lo que se le debe. Se busca por nombre y está paginada, así que con muchos
mensajeros no hace falta desplazarse hasta el final.

## El desglose

Abriendo un mensajero ves **de dónde sale cada colón**: los pagos por entrega de sus cierres
aprobados, los premios y los ajustes, cada uno con su origen.

Es el nivel donde se contesta *«¿por qué me pagaron esto?»* sin discutir de memoria.

La columna **Origen** lo dice con nombre: «Cierre del día · 2026-09-12 · Juan Pérez Mora», «Pago de
Ordenex a un mensajero · Juan Pérez Mora · 2026-09-12 · SINPE», «Premio del ranking · podio del
2026-09-10». Cuando hay pantalla para ese origen, **Ver** te lleva a ella. La fila que viene de un
cierre lleva además **Ver el cierre**.

## Filtrar el desglose por cierre

El filtro **Cierre** se elige de la lista de cierres **de este mensajero** que tienen movimientos,
cada uno con su día y cuántos movimientos trajo. Podés buscar **por día (2026-09-12) o por nombre**.
Ya no hay que copiar la dirección de ningún enlace ni pegar nada: elegís el cierre y **Aplicar**. Si la
lista dice «Mostramos los cierres más recientes», buscá por día para encontrar uno anterior.

## Registrar un pago

Desde las acciones registrás lo que se le pagó y el saldo baja. Antes de confirmar tenés una
**previsualización del reparto**, para ver cómo queda antes de aplicarlo — no después.

## Premios del ranking

El panel de premios conecta con el **Ranking**: lo que se define ahí como premio aparece acá como algo
a pagar. Un premio no es un número suelto — termina en la cuenta del mensajero.

## Cosas que te pueden pasar

**«No hay cuentas por pagar».** Nadie tiene saldo pendiente. Después de una ronda de pagos es lo
normal.

**«No se pudo cargar el desglose del mensajero».** Fallo al leer el detalle; recargá. El saldo de la
tabla sigue siendo válido.

**Un mensajero con saldo menor del que esperaba.** Los pagos entran **cuando se aprueba su cierre**, no
cuando entrega. Si tiene cierres sin aprobar, ese trabajo todavía no está contado.

## Lo que esta pantalla NO hace

- **No se aprueban cierres acá.** Eso es **Cierres**. Sin cierre aprobado no hay nada que pagar.
- **No se definen las tarifas.** Cuánto se paga por entrega se configura en **Configuración · Tarifas**.
