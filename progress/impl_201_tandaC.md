# Feature 201 — tanda C: cierres, mis-pagos, ranking, liquidación y los literales

Rama `feature/201-dinero-legible`. Alcance: **las 5 copias de `money()` que quedaban** (las 4
del censo + la local de `CierreDiaModule`) y los literales `₡…` a mano de esas mismas zonas.
**Tanda D intacta**: `pos-format.ts`, `AsignacionDetalle`, `RecepcionDetalle`,
`SateliteOrderCard` y `PriceLabel` (usan el OTRO formato: coma miles + punto decimal).

Con esto **no queda ni una copia de `money` en el repo**: `grep -rn "function money(" app/
components/ lib/` devuelve un solo resultado, `lib/config/moneda.ts:142`.

## Archivos de producción (9)

| Archivo | Qué |
|---|---|
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | **M** — copia de `money` → `import` + `export { money }`; los 4 `hint` de la tarifa; `PAGO_SIN_TARIFA_NOTA` |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | **M** — la 8ª copia, LOCAL y no exportada (no estaba en el censo) |
| `app/(app)/mis-pagos/_components/mis-pagos-labels.ts` | **M** — `export { money } from "@/lib/config/moneda"` |
| `app/(app)/ranking/_components/ranking-labels.ts` | **M** — íd. + comentario de `SIN_DATO` |
| `components/shared/liquidacion/liquidacion-labels.ts` | **M** — `import` + `export { money }` (lo usa también internamente, en `REGISTRAR_PAGO_RESPUESTA.excede`) |
| `app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx` | **M** — los 2 toasts (`registrado`, `anulado`) |
| `app/(app)/novedades/_components/RechazosSlaModule.tsx` | **M** — `montoLabel` |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | **M** — `INDEMNIZACION_MONTO_EXCEDE` y `INDEMNIZACION_MONTO_AYUDA` |
| `app/(app)/incidentes/_components/IncidentesAdminModule.tsx` | **M** — `MONTO_EXCEDE` y `MONTO_AYUDA` |

`liquidacion-labels.ts` hace `import` + `export { money }` (y no el re-export de una línea)
porque el módulo **lo usa**: `REGISTRAR_PAGO_RESPUESTA.excede` compone el disponible con él.
Lo mismo en `cierre-detalle-shared.tsx`, que lo llama ~20 veces. Los otros dos son re-export
puro. Ningún consumidor cambia un import: `CierresAdminModule`, `IncidentesAdminModule` y
`CierreFacturaDetalle` siguen sacando `money` de `cierre-detalle-shared`, igual que antes.

### `SIN_DATO` del ranking: SÍ es la raya larga

`app/(app)/ranking/_components/ranking-labels.ts:7` → `"—"`, **U+2014**, el mismo carácter
exacto que `SIN_MONTO_RAYA` (comprobado por codepoint, no a ojo). Por eso la mudanza no
cambia lo que ve el mensajero y no hizo falta consultar.

**Se conserva declarado aparte**, no aliaseado a `SIN_MONTO_RAYA`: `SIN_DATO` también rotula
el PORCENTAJE y la POSICIÓN del ranking, que no son dinero y no deben depender de la
configuración de moneda. Que no diverjan en silencio —«—» en el porcentaje y «-» en el premio,
en la misma fila— lo vigila ahora una aserción en `RankingHistoricoModule.test.tsx`.

### Los literales que NO se tocaron, a propósito

El **ejemplo de entrada** de los dos avisos de tope (`por ejemplo 12500.00`) sigue crudo: es lo
que hay que teclear en un campo que no admite separador de miles. El tope sí se formatea, que
es justo lo que el mensaje intenta explicar: «no puede superar ₡9.999.999.999,99» se lee de un
vistazo; `₡9999999999.99` hay que contarlo con el dedo.

`MSG_TOPE_TECNICO` (`lib/utils/tope-indemnizacion.ts:53`) tampoco se toca: no lleva símbolo y
es del servidor.

## Censo money-safe: 4 de mis archivos estaban dentro

`tests/unit/guards/liquidacion-money-safe.test.ts` (`ARCHIVOS_DE_LA_FEATURE`):
`CierresAdminModule.tsx`, `mis-pagos-labels.ts`, `PagoTiendaAcciones.tsx` y
`liquidacion-labels.ts`. Ninguno gana `Number(` / `parseFloat(` / `parseInt(` / `.toFixed(`:
`money` no convierte a número. `liquidacion-labels.ts` y `PagoTiendaAcciones.tsx` están además
en el censo de `liquidacion-alcance.test.ts`, que prohíbe nombres de caja y `@/lib/analytics`;
`@/lib/config/moneda` no es ninguno de los dos. Los otros cinco archivos no están en ningún
censo (`cierre-detalle-shared` y `CierreDiaModule` sí aparecen en
`incidente-exhaustividad.test.ts`, pero por `RESULTADO_LABEL`, no por dinero). **51 archivos de
guardias y descarga, 414/414.**

## Tests: 97 valores esperados en 19 archivos

Se actualizó el VALOR. Ni un `describe`, ni un `it`, ni qué se comprueba, ni sobre qué elemento.

| Archivo | Valores |
|---|---:|
| `tests/components/CierresAdminModule.test.tsx` | 20 |
| `tests/components/CierreDiaModule.test.tsx` | 13 |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | 10 |
| `tests/integration/mis-pagos-page.test.tsx` | 10 |
| `tests/components/PagosRegistradosTabla.test.tsx` | 8 |
| `tests/components/CierresAdminPagoMensajero.test.tsx` | 7 |
| `tests/components/IncidentesAdminModule.test.tsx` | 5 |
| `tests/integration/wallet-tiendas-pago.test.tsx` | 4 |
| `tests/components/CierresAdminIndemnizacion.test.tsx` | 3 |
| `tests/components/RechazosSlaModule.test.tsx` | 3 |
| `tests/components/AnularPagoDialog.test.tsx` | 2 |
| `tests/components/CierreDiaModuleIncidente.test.tsx` | 2 |
| `tests/components/RankingModule.test.tsx` | 2 |
| `tests/components/RegistrarPagoDialog.test.tsx` | 2 |
| `tests/components/descarga/RankingHistoricoDescarga.test.tsx` | 2 |
| `tests/components/CierreDetalleIncidente.test.tsx` | 1 |
| `tests/components/RankingHistoricoModule.test.tsx` | 1 |
| `tests/components/RankingPodio.test.tsx` | 1 |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | 1 |
| **Total** | **97** |

De esos 97, **4 son comentarios** (`CierreDiaModule:425`, `CierreDiaModuleIncidente:198`,
`RechazosSlaModule:112`, `RankingHistoricoDescarga:5`); los otros 93 son aserciones o el
esperado del que se derivan.

La reescritura de literales la hizo un script con la MISMA agrupación de `lib/config/moneda.ts`
—reescrita, no importada: copiar el módulo haría que un fallo del módulo se colara en el
esperado— y con autocomprobación de 13 casos antes de escribir nada, incluidos los tres bordes
que importan: el signo va DELANTE (`₡-1500.00` → `-₡1.500,00`), lo ya convertido no se vuelve a
tocar (`₡13.331.832,72` es idempotente) y un `₡` suelto de matcher no se toca. El script además
**imprime toda línea con `₡` que NO convirtió**, que es como salieron los seis repasos de abajo.

### Lo que NO se convirtió, a propósito

1. **Las columnas de descarga.** `RankingHistoricoDescarga:178`
   (`expect(String(celda)).not.toContain("₡")`) sigue igual: el archivo lleva el monto crudo
   para que la celda del XLSX sea numérica. En ese mismo test la aserción de la PANTALLA
   (línea 167) sí se actualizó: es la mitad que demuestra que el archivo no adorna.
2. **Los matchers de presencia/ausencia sin valor** (`queryByText(/₡/)` en
   `CierreDiaModuleIncidente:212` y `RechazosSlaModule:113`): no llevan importe.
3. **Un `it`**: `IncidentesAdminModule.test.tsx:481` dice `no «₡0.00»` y su aserción ahora
   comprueba `₡0,00`. El script lo había convertido y **se revirtió** porque el encargo dice
   explícitamente que no se toca el `it`. Queda un título con un valor escrito en una notación
   que la app ya no emite → **decisión tuya**: es un cambio de un carácter.

### Los seis repasos a mano

- **`AnularPagoDialog:258`** — el script rompió un matcher de REGEX (`/₡9999999999\.99/`):
  agrupó dentro del literal y dejó `/₡9.999.999.999\.99/`, donde los `.` son comodines y el
  `\.` final ya no casa con la coma. Corregido a `/₡9\.999\.999\.999,99/`.
- **`PagosRegistradosTabla:387`** — la otra regex (`/₡10\.00/`); el punto escapado impedía que
  el script la viera. A `/₡10,00/`.
- **`wallet-tiendas-pago:151`** — un comentario en PROSA («DESPUÉS de pagar ₡4.000», con punto
  de millar español) que el script leyó como importe crudo y convirtió a `₡4,000`. Revertido.
- **`ColasPaginacion`** — los cinco esperados compuestos (`` `₡${AGREGADOS.neto}` ``) →
  `money(AGREGADOS.neto)`. Esas aserciones no miden el formato: miden **de qué conjunto** sale
  cada agregado, así que el esperado tiene que seguir derivándose del doble. Y los cinco de
  `AGREGADOS_DE_LA_PAGINA` —los valores cuya AUSENCIA se afirma— también pasan por `money`:
  una ausencia escrita en un formato que la app ya no emite se cumple sola.
- **`BajoRiesgoPaginacion:522`** — `textoFila: (i) => \`₡${1000 + i}.00\`` →
  `money(\`${1000 + i}.00\`)`, derivado del mismo importe que arma el doble.
- **`CierresAdminIndemnizacion`** — ver el hallazgo de abajo.

## Hallazgo — una aserción que se habría quedado hueca

`CierresAdminIndemnizacion.test.tsx` tenía tres aserciones sobre el tope, escritas contra el
CONTRATO (`INDEMNIZACION_MONTO_MAX = "9999999999.99"`) y no contra un número tecleado. Dos se
pusieron en rojo solas al formatear el mensaje. **La tercera no**:

```ts
// «un monto mal FORMADO recibe otro mensaje»
expect(texto).not.toContain(INDEMNIZACION_MONTO_MAX);
```

Es una aserción de AUSENCIA. Con el tope crudo seguía en verde para siempre —ese texto ya no
aparece en ninguna pantalla— y el día que el mensaje de formato empezara a nombrar el tope,
nadie se enteraría. Las tres pasan ahora por `money(INDEMNIZACION_MONTO_MAX)`: siguen saliendo
del contrato y vuelven a morder.

## El marcador de nulo: cobertura nueva, matada con la mutación

Se añadió **`RankingHistoricoModule.test.tsx` → «R31: sin premio, la celda pinta la raya larga
de "no hay importe" y no un cero»**. Mide LA CELDA del premio, localizada por su rótulo
(`RANKING_HISTORICO_COLUMNAS.premio`) y no por una posición escrita a mano, sobre la fila de
Beto —que sí tiene porcentaje («80.0%») y no tiene premio—, así que el único «no hay importe»
de esa fila es el que sale de `money`. El esperado es la CONSTANTE `SIN_MONTO_RAYA`, no el
carácter tecleado: nadie tiene que distinguir a ojo un «—» de un «-» al leer el test.

**Mutación:** `money` devolviendo `SIN_MONTO` (`"-"`) en vez de `SIN_MONTO_RAYA` (`"—"`).

```
AssertionError: expected '-' to be '—'
  tests/components/RankingHistoricoModule.test.tsx  → 1 rojo (el nuevo)
  tests/unit/components/desglose-tienda-labels.test.ts → 1 rojo (el único que había)
```

Revertida (el archivo se comparó byte a byte con la copia pre-mutación).

**Y confirma que el agujero era real**: la aserción que YA existía en ese mismo archivo
(`expect(within(filaCaro).getAllByText("—").length).toBeGreaterThanOrEqual(2)`) **sobrevivió a
la mutación**. Cuenta cuántos «—» hay en la fila sin decir cuál es de dinero, y la fila de Caro
tiene además el «—» del porcentaje y el de la posición: con el premio en «-» seguían siendo 2.
Se deja como está (mide otra cosa) y se documenta al lado del test nuevo.

Además, `expect(SIN_DATO).toBe(SIN_MONTO_RAYA)` en el mismo test: es la pantalla donde el «sin
dato» del ranking y el «sin monto» se pintan uno al lado del otro en la misma fila.

## Lo que la migración NO deja cubierto

`PAGO_SIN_TARIFA_NOTA` (`cierre-detalle-shared`) es la única cadena que cambié sin ningún test
encima: `grep -rn "PAGO_SIN_TARIFA_NOTA\|se resolvió en" tests/` no devuelve nada. Es un
`title`/`aria-label`, y el cero se compone con `money("0.00")` en vez de escribirse, así que no
puede divergir de la celda que explica. Lo apunto porque el barrido lo encontró, no porque
crea que hay que arreglarlo aquí.

## Verificación

| Comando | Resultado |
|---|---|
| `pnpm exec vitest run tests/components tests/integration tests/unit` | **1052 archivos, 13051/13051** |
| `pnpm exec vitest run tests/unit/guards tests/unit/descarga` | **51 archivos, 414/414** |
| `pnpm exec tsc --noEmit` | **limpio** |

13050 tests antes de la tanda, 13051 después: el +1 es el del marcador de nulo.
`pnpm exec eslint` sobre los 9 archivos de producción y los 19 de test → limpio.

### La otra dirección: ¿muerden los 97 valores nuevos?

Queda probada por construcción, y medida. Con la producción migrada y los tests SIN tocar, la
suite dio **58 rojos en 19 archivos**. Esos mismos 58 pasan a verde cambiando solo el valor
esperado, lo que solo puede ocurrir si las cinco mudanzas llegaron de verdad a sus
consumidores. El mapa rojo→origen cubre las cinco copias y los literales uno a uno:

- `cierre-detalle-shared` → `CierresAdminModule` (16), `CierreDetalleIncidente`,
  `AnularPagoDialog`… **incluidos los 4 `hint`** («el desglose por orden … muestra la tarifa
  congelada con su fórmula» cayó por `₡2000.00`).
- `CierreDiaModule` (la 8ª, local) → `CierreDiaModule` (6) + `CierreDiaModuleIncidente`.
- `mis-pagos-labels` → `mis-pagos-page` (3 rojos de 10 valores).
- `ranking-labels` → `RankingModule`, `RankingPodio`, `RankingHistoricoModule`,
  `RankingHistoricoDescarga`.
- `liquidacion-labels` → `PagosRegistradosTabla` (5), `RegistrarPagoDialog`,
  `CierresAdminPagoMensajero`, y **las 3 aserciones de `wallet-tiendas-pago` que la tanda B
  dejó a propósito**.
- Literales: `RechazosSlaModule` (2), los toasts de `PagoTiendaAcciones`
  (`wallet-tiendas-pago:769`, el saldo negativo), y los topes de indemnización
  (`CierresAdminIndemnizacion` ×2, `IncidentesAdminModule` vía la constante importada).

`/wallet/tiendas` deja de estar incoherente: la cabecera decía `₡9.000,00` y el toast
`Pago de ₡4000.00 registrado.`; ahora los dos hablan igual, y el saldo negativo se lee
`-₡15.000,00` (signo delante del símbolo).
