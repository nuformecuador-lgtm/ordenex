# Cabos sueltos de la sesión — rama `chore/deuda-203-cabos`

Tres arreglos pequeños en `/wallet/mensajeros` y en un comentario de test. Cada uno se decidió
con la app delante (Playwright sobre el `pnpm dev` local, `admin.qa@ordenex.test`, 2026-08-12) y
no solo leyendo el componente.

---

## 1 — El aviso de los importes brutos se pintaba DOS veces en la misma pantalla

**Qué se vio.** Con la fila de Marco desplegada, la pantalla tenía **dos** elementos
`role="note"` con el mismo párrafo y los rótulos cambiados:

```
nota[0] «Pagado» sigue contando los pagos que se anularon, y «Devengado» suma la devolución…
nota[1] «Total pagado» sigue contando los pagos que se anularon, y «Total devengado» suma…
```

Geometría medida (ventana 1440×900, `scrollY = 0`): el aviso de la tabla en **y=181** (alto 32),
la sección del desglose en **y=357** y su aviso en **y=457**. O sea: los dos **a la vista al mismo
tiempo**, a 276 px uno del otro. Y como `DataTable` admite varias filas abiertas a la vez, cada
fila desplegada añadía otra copia del mismo párrafo.

**La comprobación que pedía el encargo** («si al abrir el desglose el aviso de la cabecera queda
fuera de pantalla, la respuesta es la contraria»): con la primera fila, **no** queda fuera —está
en y=181, dentro de la ventana, y sigue estándolo con ventanas de 720 y 600 px—. Pero la base
local **solo tiene un mensajero**, y el tamaño de página de producción es **25**
(`walletMensajeroConfig.DEFAULT_PAGE_SIZE`). Con la altura de fila medida (**42 px**, primera fila
en y=303) el desglose de la fila *k* arranca en `303 + 42·k`:

| fila | y del desglose | el aviso de la cabecera queda… |
|---|---|---|
| 1 | 345 | a 164 px → cabe junto al desglose |
| 10 | 723 | a 542 px → cabe |
| 15 | 933 | a 752 px → cabe |
| **19** | **1059** | **fuera de la ventana al scrollear al desglose** |
| 25 | 1353 | fuera |

Así que las dos mitades del encargo son ciertas a la vez, según la fila: repetir el párrafo es
ruido arriba, y borrarlo del desglose deja sin aviso a las filas de abajo. Hay un tercer motivo
para no dejar que hable solo el de la tabla: los tres importes del desglose son los del **conjunto
FILTRADO** (R22 de la 44), no los de la fila; al filtrar por fecha cambian, y el párrafo de arriba
habla de otras cifras y con otros rótulos.

**Qué se hizo.** El párrafo se pinta **una sola vez**, en la cabecera de la tabla —la única
superficie que se ve sin desplegar nada, como decía tu lectura—. En el desglose la salvedad **no
desaparece**: baja a la pista de cada importe, que ya existía, en una línea y con las MISMAS
palabras que llevan las cabeceras del archivo descargable (`ENCABEZADOS_DESCARGA_MAESTRO`):

| importe | pista antes | pista ahora |
|---|---|---|
| Total devengado | Lo que Ordenex le debe por sus entregas | …por sus entregas. **Incluye la devolución de los pagos anulados.** |
| Total pagado | Lo ya entregado (del efectivo recaudado) | …(del efectivo recaudado). **Incluye los pagos anulados.** |
| Cuenta por pagar | Lo pendiente de pagar al mensajero | …al mensajero. **Es el número correcto: ya tiene descontado lo anulado.** |

La regla del leader de la 172 («el aviso hace falta donde se muestre un IMPORTE AGREGADO que
incluya lo anulado») se conserva entera: cambia la forma, no la regla.

**Comprobado en la app después del cambio:** `role=note` en la pantalla con el desglose abierto =
**1**, y es el de la tabla. Las tres pistas del desglose llevan la salvedad.

**Money-safe.** `wallet-mensajeros-labels.ts` está en el censo de
`tests/unit/guards/liquidacion-money-safe.test.ts`. Solo se tocaron cadenas: ni `Number(`, ni
`parseFloat(`, ni `parseInt(`, ni `.toFixed(`, ni biblioteca de decimales. El guard pasa.

---

## 2 — El filtro «Cierre» que pedía un uuid tecleado a mano

**Primero, de dónde saldría ese id.** Medido en la app: en el desglose hay dos enlaces «Ver el
cierre», y el identificador **no se ve en pantalla** — viaja en un `<span className="sr-only">`
(`CIERRE_ENLACE.identificacion`, feature 205/R44), solo para lectores de pantalla. El texto
visible es únicamente «Ver el cierre», y el uuid solo aparece en el `href`
(`/cierres-admin?cierre=70ebf5e2-…`). Conclusión: **nadie puede teclearlo mirando la pantalla**;
hay que copiar la dirección del enlace, o abrirlo y tomarlo de la barra del navegador.

**Si se podía quitar.** No, y por tres razones comprobadas:

1. el `cierreId` va al **WHERE server-side** (`lib/types/wallet-mensajero.ts:149`,
   `cierreId: z.string().min(1).optional()`), y el desglose pagina en el servidor;
2. el mismo filtro **viaja en la descarga** del desglose completo (`buildInputCompleto`);
3. lo **ejercitan dos casos** de `tests/integration/wallet-mensajeros-page.test.tsx` (R22): que la
   action se invoque con `cierreId: "c1"` y que el saldo pase a reflejar el conjunto filtrado.

Además, el mismo campo con el mismo `placeholder` existe en otras tres pantallas
(`/mi-wallet`, `/mis-pagos`, `/wallet/tiendas`): quitarlo aquí sería dejar la app diciendo dos
cosas distintas. Y hay un flujo real en el que la persona **sí** tiene el id: llega desde
`/cierres-admin?cierre=<uuid>` investigando un cierre concreto y lo tiene en la barra.

**Decisión: (a), mejorar lo que la pantalla promete.** El rótulo «Cierre» se queda (es el mismo de
la columna, y lo usan los tests por `getByLabelText`). Cambia el `placeholder` —de «ID del cierre»
a «**Pegá el identificador**», que dice el gesto correcto: se pega, no se teclea— y se añade una
línea de ayuda bajo la fila de filtros:

> El identificador del cierre sale del enlace «Ver el cierre» de la tabla: copiá su dirección y
> pegala en «Cierre».

Va **debajo** de la fila y no dentro de la columna del campo para no descolgarlo de los otros dos
(la fila alinea por abajo); el vínculo con el campo lo hace `aria-describedby`, así que un lector
de pantalla lo anuncia al enfocar el campo. Comprobado en la app: los tres inputs y los dos
botones quedan a la misma altura (`top = 609` los cinco) y la ayuda a 649.

---

## 3 — Un comentario que contradecía a su fixture

`tests/components/RepartoPrevisualizacion.test.tsx` (caso «con deuda no imputable lo dice, y sin
ella no lo dice»): decía «los **cuatro** cierres del mensajero caben en la ventana» sobre un
fixture con `enVentana: 3, fuera: 0` e `imputable: "12400.00"` = 4.000 + 5.000 + 3.400, que son
**tres**. Las cifras cuadran; mentía el comentario. Corregido a «los **tres** cierres», citando
los campos del fixture y el desglose de la suma para que la próxima lectura no tenga que
recalcularlo.

---

## Cómo se comprobó que el arreglo del punto 1 está medido

El caso nuevo «con el desglose ABIERTO, el párrafo sigue apareciendo UNA sola vez» pasó **en
verde con el defecto puesto a mano** la primera vez. El motivo no era el caso, era el mock: el
archivo devolvía `items: []` en `listarCuentasPorPagarPaginadoAction`, así que la fila —y con
ella el desglose desplegado— **desaparecía** en cuanto SWR relevaba el `fallbackData`, y el
conteo decía «1» por no haber nada que contar. Arreglado el mock (la misma fila por las dos vías,
en un `vi.hoisted`) y añadido un ancla que exige que el desglose siga montado al contar, la
mutación —el párrafo duplicado, de vuelta en el componente— pone el archivo en **rojo en dos
casos**. Revertida la mutación, verde.

## Verificación

| Comando | Resultado |
|---|---|
| `pnpm exec vitest run tests/components tests/unit/guards` | **203 archivos / 2559 tests, todos en verde** |
| `pnpm exec tsc --noEmit` | **limpio** |
| `pnpm exec vitest run tests/integration/wallet-mensajeros-page.test.tsx tests/unit/guards/liquidacion-money-safe.test.ts` | 2 archivos / 16 tests en verde |
| `pnpm exec eslint` (los 4 archivos tocados) | limpio |

No se tocó `vitest.config.ts` ni `tests/unit/services/` (agente en paralelo).
