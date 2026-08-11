# Feature 201 — tanda B: la familia wallet

Rama `feature/201-dinero-legible`. Alcance: las TRES copias de `money()` de la familia wallet
y los tests que la migración puso en rojo. **Tanda C intacta** (`cierres-admin`, `mis-pagos`,
`ranking`, `liquidacion`, y el `money` local de `CierreDiaModule`).

## Archivos de producción (4)

| Archivo | Qué |
|---|---|
| `lib/config/moneda.ts` | **M** — `money(value)` nuevo: `formatMontoString(value, SIN_MONTO_RAYA)`. Nada más. |
| `app/(app)/wallet/_components/wallet-labels.ts` | **M** — `export { money } from "@/lib/config/moneda"` |
| `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` | **M** — íd. |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` | **M** — íd. |

Una sola función, tres re-exports. Ningún consumidor cambia un import: el precedente es el
`export { montoValido } from "@/components/shared/monto-cliente"` que ya vive al final de
`wallet-labels.ts`. Se llama `money` y no `formatMoney` justamente para que el re-export no
necesite alias y la mudanza no se convierta en refactorización.

**El marcador de ausencia se conserva**: `money` pasa `SIN_MONTO_RAYA` (`"—"`), no el default
`SIN_MONTO` (`"-"`). Mutado y comprobado (ver abajo).

## Quién consume cada copia

- `wallet-labels` → `CajaResumenCard`, `DesgloseEgresosCard`, `GastosFijosPlantillasPanel`,
  `WalletLedger`.
- `wallet-mensajeros-labels` → `CuentasPorPagarTable`, `DesglosePagosMensajero`.
- `mi-wallet-labels` → `DesgloseTiendaLedger`, `SaldoTiendaCard` **y las dos superficies de
  `/wallet/tiendas`**.

### De dónde sacaba `/wallet/tiendas` su `money`

De `mi-wallet-labels`, por DOS caminos, y ninguno de los dos es una copia:

- `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx:17` lo importa **directo**:
  `import { money } from "../../../mi-wallet/_components/mi-wallet-labels";`
- `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts:20-27` lo **re-exporta** de
  ahí (R20 de la feature 171: «es el MISMO ledger… dos mapas paralelos divergirían»), y de ese
  re-export lo toma `DesgloseMovimientosTienda.tsx`.

Por eso migrar `mi-wallet-labels` migró `/wallet/tiendas` sin tocar un archivo de esa carpeta,
y por eso `wallet-tiendas-desglose` (21 aserciones) y `wallet-tiendas-pago` (9) se pusieron
rojos: es la prueba directa de que la cadena de re-exports funciona.

## Tests: 96 aserciones en 12 archivos

Se actualizó el VALOR ESPERADO. Ni un `describe`, ni un `it`, ni qué se comprueba, ni sobre
qué elemento.

| Archivo | Aserc. | Coment. |
|---|---:|---:|
| `tests/integration/wallet-tiendas-desglose.test.tsx` | 21 | 1 |
| `tests/integration/mi-wallet-page.test.tsx` | 18 | 3 |
| `tests/components/CajaResumenCard.test.tsx` | 16 | 0 |
| `tests/integration/wallet-tiendas-pago.test.tsx` | 9 | 1 |
| `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx` | 8 | 6 |
| `tests/unit/components/wallet-desglose-egresos-card.test.tsx` | 8 | 0 |
| `tests/integration/wallet-mensajeros-page.test.tsx` | 5 | 3 |
| `tests/components/CuentasPorPagarTable.test.tsx` | 4 | 0 |
| `tests/components/WalletMensajerosAvisoBrutos.test.tsx` | 3 | 0 |
| `tests/unit/components/desglose-tienda-labels.test.ts` | 2 | 0 |
| `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` | 1 | 0 |
| `tests/unit/components/wallet-indemnizacion-libro.test.tsx` | 1 | 0 |
| **Total** | **96** | **14** |

Más `tests/components/descarga/WalletDescarga.test.tsx`, que no tenía ninguna aserción de
importe pero sí dos fixtures rotos (abajo).

La reescritura de literales la hizo un script con la MISMA agrupación de `lib/config/moneda.ts`
y con autocomprobación de 7 casos antes de escribir nada (`₡-500.00` → `-₡500,00` entre ellos:
el signo se va DELANTE del símbolo). Los repasos a mano fueron los cuatro de abajo.

### Lo que NO se convirtió, a propósito

1. **Las columnas de descarga.** Las seis aserciones `expect(String(fila.monto)).not.toContain("₡")`
   (`wallet-caja`, `wallet-tienda`, `wallet-mensajero`, `desglose-tienda`, `WalletDescarga`,
   `WalletPropsDescarga`) siguen igual: el archivo lleva el monto crudo para que la celda del
   XLSX sea numérica.
2. **Tres aserciones de `wallet-tiendas-pago.test.tsx`** (`₡4000.00`, líneas ~570/~600/~735).
   Son de la tabla «Pagos registrados», que la pinta `components/shared/liquidacion/PagosRegistradosTabla`
   con el `money` de `liquidacion-labels` — **tanda C**. El script las había convertido y las
   dejó rojas; se revirtieron con un comentario que dice por qué. Esa pantalla queda un rato
   con la cabecera en formato nuevo y la tabla de comprobantes en el viejo.
3. **El toast de anulación** (`"Pago anulado. El saldo de la tienda quedó en ₡-15000.00."`).
   Ver «Hallazgo 2».

### Los cuatro repasos a mano

- **Composiciones `` `₡${dato}` `` → `money(dato)`** (3 en `CuentasPorPagarPaginacion`, 4 en
  `mi-wallet-page`). Esas aserciones no miden el formato: miden **de qué fila / de qué campo**
  es el importe («¿el desglose de la página 3 enseña el dinero del 51 o el del que ocupaba su
  sitio en la página 1?»). El esperado tenía que seguir DERIVÁNDOSE del doble, así que se
  deriva con el mismo formateador en vez de con un `₡` a mano. Se importa `money` de
  `@/lib/config/moneda` en los dos archivos.
- **Los matchers `getByText(/^₡/)` de `mi-wallet-page`** (`importeDe`, `saldoEnPantalla`) →
  `/^-?₡/`. Un importe negativo se pinta `-₡450,00` y el matcher viejo dejaría de encontrarlo
  justo cuando la tienda debe dinero. En este archivo todos los casos renderizados son
  positivos (el único negativo, `"-450.00"`, se comprueba sobre las props, no sobre el DOM),
  así que el elemento elegido es el mismo que antes.
- **Dos comentarios** que el script se saltó por terminar en punto (`₡500.00.`, `₡1.25.`).
- **`tests/components/descarga/WalletDescarga.test.tsx`**: los dos fixtures del hallazgo 1.

## Hallazgo 1 — un fixture que mentía con `as never`

`WalletDescarga.test.tsx` tenía `const DESGLOSE_EGRESOS = {} as never;` y un mock
`verDesgloseEgresosAction: … ({ status: "ok", desglose: {} })`. `DesgloseEgresosDTO` declara
sus **cinco** montos obligatorios; el `as never` silenciaba a TypeScript.

Con el `money` viejo, `money(undefined)` devolvía `"₡undefined"`: la tarjeta pintaba basura y
nadie se enteraba. El compartido llama a `.trim()` sobre el STRING, así que el `undefined`
revienta el render y los 6 tests del archivo caían con `TypeError`.

**No se debilitó el helper.** La firma `string | null` es la de la tanda A y aceptar `undefined`
convertiría un campo que falta en un `"—"` («no hay importe») cuando lo que hay es un contrato
incumplido. Se rellenaron los dos fixtures con montos de verdad, igual que `RESUMEN` y
`DESGLOSE_TIENDA` justo al lado, que ya llevaban ese mismo comentario («el dato se adapta para
que el módulo monte»). El archivo mide la DESCARGA; su intención no cambia.

## Hallazgo 2 — dos `₡` a mano en producción, en `/wallet/tiendas`, SIN migrar

`app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx`:

```ts
registrado: (monto: string) => `Pago de ₡${monto} registrado.`,          // línea 62
anulado: (saldo: string) => `Pago anulado. El saldo de la tienda quedó en ₡${saldo}.`,  // 69
```

No son copias de `money()` —son plantillas sueltas que hacen su mismo trabajo— y por eso no
entraban en el encargo («las TRES copias de `money()`»), ni están en la lista de la tanda C.
**No se tocaron**, y su aserción de test sigue esperando `₡-15000.00`.

Consecuencia visible: tras esta tanda, `/wallet/tiendas` muestra `₡9.000,00` en la cabecera y
`Pago de ₡4000.00 registrado.` en el toast. Queda para que el leader decida dónde cae.

El barrido completo de `₡` literales en `app/`, `components/` y `lib/` deja además, todos fuera
de la familia wallet: `CierreDiaModule.tsx:266` (un `money` local, no exportado, que no figuraba
en el censo de siete), los avisos de tope de indemnización de `CierresAdminModule` e
`IncidentesAdminModule`, los `hint` de `cierre-detalle-shared`, `RechazosSlaModule:47`,
`ranking-labels`, `mis-pagos-labels`, `liquidacion-labels`, y los tres formateadores propios de
`mis-asignaciones` / `recepcion-satelite` / `PriceLabel`.

## Verificación

| Comando | Resultado |
|---|---|
| `pnpm exec vitest run tests/components tests/integration tests/unit/components` | **394 archivos, 4721/4721** |
| `pnpm exec vitest run tests/unit/descarga tests/unit/guards` | **51 archivos, 414/414** |
| `pnpm exec tsc --noEmit` | **limpio** |

Extra: `pnpm exec vitest run tests/unit` → 700 archivos, 8838/8838. `pnpm exec eslint` sobre
los 17 archivos tocados → limpio.

### Matado con una mutación

La que importaba: `money` devolviendo `SIN_MONTO` (guion corto) en vez de `SIN_MONTO_RAYA`.

```
AssertionError: expected '-' to be '—'
  tests/unit/components/desglose-tienda-labels.test.ts  →  1 rojo
```

Revertida. **Aviso: esa es la ÚNICA aserción de todo el repo sobre `money(null)`**
(`git grep "money(null" tests` devuelve una sola línea). El marcador de ausencia de las otras
dos ramas de la familia —`wallet-labels` y `wallet-mensajeros-labels`— no lo cubre nadie; si
alguien borra ese test, el guion largo deja de estar vigilado en toda la wallet.

La otra dirección —¿muerden las 96 aserciones nuevas?— quedó probada por construcción: las
mismas 46 pruebas que estaban en rojo con los valores viejos pasan a verde con los nuevos y
sólo cambiando el valor, lo que sólo puede pasar si los tres re-exports llegaron de verdad a
sus consumidores.
