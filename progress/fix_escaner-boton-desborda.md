# fix: el botón de confirmar se salía de la tarjeta de escaneo

Rama: `fix/escaner-boton-desborda` (desde `origin/dev`). Zona: frontend.
Defecto reportado por el humano en `/recoleccion`: el botón "Confirmar recolección"
se sale de la card.

## Diagnóstico (verificado en código, no asumido)

Todo el defecto vive en `components/shared/EscanerGuiaCard.tsx`, en el bloque de
entrada manual. Tres piezas que se suman:

1. La tarjeta es `w-full max-w-md … p-6 sm:p-8` (línea 84): desde `sm` deja
   **384 px de ancho interior** (448 − 32 − 32).
2. El contenedor del formulario era `flex flex-col gap-3 sm:flex-row` (línea 132):
   desde `sm` el input y el botón iban en **fila**.
3. Ninguno de los dos podía ceder ancho en esa fila:
   - el input era `h-11 flex-1 … px-3.5`; en flex, `min-width: auto` impide bajar
     de su ancho intrínseco (un `<input>` sin `size` ronda las 20 columnas);
   - el botón era `h-11 shrink-0 px-6`, y además la primitiva `components/ui/button.tsx`
     ya trae `shrink-0` y `whitespace-nowrap` en la base de la `cva`. O sea: el
     texto no parte y la caja no encoge.

Con esas tres, el ancho pedido por la fila crece linealmente con el largo de la
etiqueta y, pasado el umbral, se desborda de los 384 px. Por eso solo se veía en
`/recoleccion`: `"Confirmar recolección"` (21 caracteres) es la etiqueta más larga
de las seis superficies que consumen la tarjeta; las demás son `"Recibir"` (×3) y
`"Recoger"`, y `EscanerRecepcionOrigen` ni siquiera pasa `manual` (solo cámara).

Confirmado también que **ningún consumidor pasa `className`** a `EscanerGuiaCard`,
así que ninguno podía estar restaurando ni alterando el layout por su cuenta: el
arreglo en el componente compartido llega igual a los seis.

## Cambio

Un solo archivo: `components/shared/EscanerGuiaCard.tsx`.

- El contenedor pasa de `flex flex-col gap-3 sm:flex-row` a `flex flex-col gap-3`:
  el botón queda **siempre** debajo del input, en todos los anchos.
- El input pasa de `flex-1` a `w-full`. En columna, `flex-1` opera sobre el eje
  principal (la altura), que no es lo que se quiere; `w-full` es lo que expresa la
  intención y no depende del contexto flex.
- El botón pasa de `h-11 shrink-0 px-6` a `h-11 w-full`. `shrink-0` era redundante
  (ya está en la base de la primitiva) y en columna no aplica al ancho; `px-6` era
  padding para reservar aire lateral en la fila, y con el botón a ancho completo y
  el label centrado (`justify-center`) no aporta nada — se quita.
- Queda un comentario en el sitio explicando por qué está apilado, para que nadie
  reponga `sm:flex-row`.

Decisión del leader respetada: se toca el componente **compartido** y afecta a las
seis superficies a propósito. **No** se introdujo prop de variante ni condicional
por consumidor — sostener dos layouts donde uno sirve es la complejidad que abre la
puerta a que el defecto vuelva por otra etiqueta.

Riesgo residual conocido y aceptado: una etiqueta absurdamente larga (>50 caracteres
aprox.) seguiría sin caber, porque la primitiva `Button` es `whitespace-nowrap` y el
alto está fijo en `h-11`. Arreglarlo exigiría cambiar el alto del botón en todo el
producto; fuera del alcance de este fix y muy lejos de cualquier etiqueta real.

## Consumidores verificados

Ninguno requirió ajuste propio; los seis se leyeron y sus tests pasan sin tocarlos.

| Superficie | `submitLabel` | Nota |
| --- | --- | --- |
| `app/(app)/recoleccion/_components/RecoleccionModule.tsx` | `Confirmar recolección` | el del reporte |
| `app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx` | `Recoger` | |
| `app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx` | `Recibir` | |
| `app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx` | — | sin `manual`: solo cámara, no tiene el bloque |
| `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx` | `Recibir` | |
| `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` | — | renderiza `EscanerRecepcion` |

## Evidencia

`pnpm run typecheck` — verde, sin salida de `tsc`:

```
> ordenex@0.1.0 typecheck
> tsc --noEmit
```

`pnpm run lint` — **0 errores**, 20 warnings, todos preexistentes y todos en
`tests/**` (`no-unused-vars`); ninguno en archivos tocados:

```
✖ 20 problems (0 errors, 20 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

`pnpm test tests/components tests/unit/components`:

```
 Test Files  163 passed (163)
      Tests  1904 passed (1904)
   Duration  166.57s
```

Corrida dirigida a los tests de las superficies afectadas (incluye
`RecoleccionModule`, `EscanerRecepcion*`, `RecepcionSatelite*` y los de recogida):

```
 Test Files  10 passed (10)
      Tests  253 passed (253)
   Duration  27.40s
```

Suite completa (`pnpm test`), para confirmar que se conserva el estado del arnés
(665 archivos / 8052 tests, exactamente el baseline previo al fix):

```
 Test Files  665 passed (665)
      Tests  8052 passed (8052)
   Duration  190.72s
```

Nada se rompió entre los tests que buscan el botón por rol + nombre accesible, que es
lo esperado: el cambio es puramente de layout, no toca marcado semántico, `type`,
`disabled`, `loading` ni el texto del botón. Tampoco hay ningún test que asercione
sobre estas clases (se comprobó: `sm:flex-row` y `shrink-0 px-6` no aparecen en
`tests/`), así que no hubo que "acomodar" ninguna prueba al cambio.
