# Feature 201 — tanda D: el OTRO formato (estilo EEUU) y `PriceLabel`

Rama `feature/201-dinero-legible`. Alcance: **las 4 copias del formateador "estilo EEUU"**
(coma para miles, PUNTO para decimales — `₡13,331,832.72`) que reciben `number | null`, **más
`components/shared/PriceLabel.tsx`**, más el título del `it` que la tanda C dejó mintiendo.

Con esto **no queda ni un formateador de dinero vivo fuera de `lib/config/moneda.ts`**: el
barrido final da 0 ocurrencias de `₡` en código (ver abajo).

## Archivos de producción (6)

| Archivo | Qué |
|---|---|
| `lib/config/moneda.ts` | **M** — `formatMonto(monto, sinMonto = SIN_MONTO)`: se amplía la firma con el marcador de ausencia, igual que `formatMontoString` |
| `app/(app)/mis-asignaciones/_components/pos-card/pos-format.ts` | **M** — la copia exportada → `formatMontoConfigurado(monto, SIN_MONTO_RAYA)` |
| `app/(app)/mis-asignaciones/_components/AsignacionDetalle.tsx` | **M** — íd. (copia local) |
| `app/(app)/recepcion-satelite/_components/RecepcionDetalle.tsx` | **M** — íd. (copia local) |
| `app/(app)/recepcion-satelite/_components/SateliteOrderCard.tsx` | **M** — íd. (copia local) |
| `components/shared/PriceLabel.tsx` | **M** — `Intl` fuera; prop `maxDecimals` retirada; docstring corregido |

`pos-format.formatMonto` es el único de los cuatro que se **exporta**, y lo consumen
`PosAmountRow`, `PosOrderCardMosaico`, `PosOrderCardDetalle` y `ChatConversacion`. Se conserva
la función envoltorio con su firma (`number | null`) en vez de re-exportar el compartido: los
cuatro consumidores no cambian un import y el marcador de ausencia queda fijado en UN sitio por
módulo, no repetido en cada llamada.

## El marcador de nulo: se AMPLÍA la firma del compartido

Las 4 copias devolvían `"—"` (U+2014) y `formatMonto(null)` devuelve `SIN_MONTO` (`"-"`, guion
corto). Delegar sin más habría cambiado el guion en cuatro pantallas.

**Elegido: ampliar la firma**, `formatMonto(monto: number | null, sinMonto: string = SIN_MONTO)`,
y llamar `formatMontoConfigurado(monto, SIN_MONTO_RAYA)` en los cuatro sitios. Y no el ternario
en cada archivo, por tres razones:

1. Es **el patrón que la tanda A ya estableció** en este mismo módulo para `formatMontoString`.
   Dos helpers hermanos con la misma decisión resuelta de dos maneras distintas es la clase de
   divergencia que esta feature existe para borrar.
2. El ternario deja el `null` fuera de la función: cuatro sitios donde alguien puede
   "simplificar" a `formatMonto(monto)` y cambiar el guion sin que nada chille.
3. El marcador se pasa por CONSTANTE (`SIN_MONTO_RAYA`), no tecleando el carácter: nadie tiene
   que distinguir a ojo un «—» de un «-» leyendo el diff.

Cubierto con dos casos nuevos en `tests/unit/config/moneda-formato.test.ts` (el `null` con la
raya, y que el segundo parámetro no pinta nada cuando SÍ hay importe).

### Lo que sí cambia en esas 4 pantallas, y es lo que se pedía

`₡1,250.50` → `₡1.250,50`. Y un efecto colateral que conviene tener escrito: el **signo pasa
delante del símbolo**. Las copias hacían `₡${entero}.${dec}` con el `-` dentro del entero
(`₡-1,500.00`); el compartido emite `-₡1.500,00`. `montoCobrar` no es negativo en la práctica
—es un COD a recaudar—, pero si algún día lo fuera, se leería como en el resto de la app.

### Un efecto secundario BUENO en `/recepcion-satelite`

Esa pantalla pintaba el mismo importe de dos maneras: la tabla "Recibidas" por `PriceLabel`
(`₡ 320`) y la card por su copia local (`₡320.00`). Ahora las dos dicen `₡320,00`.

## `PriceLabel`: las TRES cosas que cambian, y las que no

| | antes | ahora |
|---|---|---|
| miles | espacio fino de `Intl` es-CR (`₡ 1 234,5`) | punto (`₡1.234,50`) |
| espacio tras el símbolo | sí (`{SIMBOLO}{' '}`) | no |
| ceros finales | se comían (`₡0`, `₡1.234,5`) | se muestran (`₡0,00`, `₡1.234,50`) |

Lo que **no** cambia, y está medido: sigue pintando **`₡0,00`** —no el guion ni la raya— con
valor ausente, vacío, en blanco, no numérico, `NaN` o `Infinity`; sigue aceptando
`string | number | null`; y el `<span>` conserva `tabular-nums whitespace-nowrap`.

El cero es su CONTRATO y sus consumidores dependen de él: en `/ordenes`, una tienda sin tarifa
activa tiene flete **cero**, no flete desconocido, y eso lo decide el `toValidNumber` de la prop.
Convertirlo en «—» habría dicho otra cosa.

Implementación: `formatMonto(toValidNumber(value))`. El `toFixed(2)` del compartido es
justamente lo que devuelve los ceros finales, y el símbolo deja de estar hardcodeado
(`const SIMBOLO = "₡"` desaparece; sale de `monedaConfig`).

### `maxDecimals`: **RETIRADA**

`grep -rn "maxDecimals"` fuera del propio archivo no devolvía nada, y estorba de verdad: el
formato unificado es de escala 2 fija, así que la prop no podría hacer lo que promete. Dejarla
como argumento ignorado sería una segunda mentira en el mismo archivo. Se quita y se anota en el
docstring por qué. `tsc --noEmit` limpio: ningún consumidor la pasaba.

### El docstring MENTÍA, y ahora dice lo que sale

Prometía `₡1.234,50` cuando `Intl` con locale "es-CR" agrupa con **espacio fino** (medido:
`"1 234,5"`) y `minimumFractionDigits: 0` se comía el cero. Reescrito: dice el formato real, las
tres cosas que la feature 201 cambió y por qué, y que el valor ausente se pinta cero.

## `PriceLabel` no tenía NI UN test: ahora tiene 21

`tests/components/PriceLabel.test.tsx` — **A**, 21 casos. Un componente compartido que pinta
dinero en 5 columnas de `/ordenes` y `/recepcion-satelite`, cuya única red eran los tests de los
listados… que comprueban las CABECERAS de esas columnas, no lo que sale en la celda.

Cubre: entero (`₡1.234,00`), decimales con cero final, dos decimales sin recortar, agrupación de
miles (y que el separador no se cuela delante del primer grupo), valor `string`, valor `number`,
negativo (signo delante del símbolo), símbolo pegado sin espacio de ningún tipo, los **siete**
casos de ausencia → `₡0,00`, que el cero explícito y el ausente se pintan igual, las dos clases
del `<span>`, la composición de `className` y que el símbolo sale de configuración.

### Matado con tres mutaciones

| # | Mutación | Rojos |
|---|---|---:|
| 1 | **quitar la agrupación de miles** (`agruparMiles` devuelve `enteros`) | **8 de 21** |
| 2 | devolver el espacio tras el símbolo (`.replace("₡", "₡ ")`) | **17 de 21** |
| 3 | el valor ausente cae a `null` en vez de a 0 (rompe el contrato del `₡0`) | **4 de 21** |

La 1 es la que pidió el encargo. La 3 es la que importa de verdad: es la única que mide el
contrato que NO podía cambiar, y sin ella la migración podría haber convertido `₡0` en «—» sin
que nada chillara. Las tres revertidas; los dos archivos comparados **byte a byte** con su copia
pre-mutación (`diff` limpio) y la suite vuelve a 21/21.

## El `it` que mentía (la excepción pactada)

`tests/components/IncidentesAdminModule.test.tsx:481` — el título decía `no «₡0.00»` mientras su
aserción comprueba `queryByText("₡0,00")`. Cambiado a `no «₡0,00»`. **Es lo único que se toca de
ese archivo**, y es un carácter: un título que describe mal lo que el test hace es peor que
ninguno, porque el siguiente que lo lea buscará un formato que la app ya no emite.

## La única aserción de producción que la migración puso en rojo

`tests/components/RecogerModule.test.tsx:239` — `₡1,250.50` → `₡1.250,50`. Mide el bloque de
Cobro del detalle desplegable de la card POS (`montoCobrar: 1250.5`). **Se actualizó el VALOR**;
ni el `it`, ni qué se comprueba, ni sobre qué elemento.

Que sea UNA sola no es casualidad ni descuido: se barrió el árbol de tests con un script (con
autocomprobación de 9 casos: reconoce `₡13,331,832.72` y `₡0.00`, y NO marca `₡13.331.832,72` ni
`₡5.000`) y las otras 11 ocurrencias de formato viejo son prosa de comentarios o strings de
entrada de validadores de schema (`["con simbolo de moneda", "₡100.00"]`, que miden que el
validador RECHACE un importe con símbolo — nada que ver con el formato de salida).

`tests/unit/config/moneda-formato.test.ts` — **M**, 3 casos nuevos (el marcador por parámetro y
que un entero se pinta con los dos decimales, frente al `formatMontoString` que copia verbatim).

## Fuera de alcance, NO tocado

`calcularFleteConIva(row)` y `calcularComisionConIva(row)` (`ordenes-columns.tsx:166,180`) son
**aritmética de dinero en el navegador** y alimentan dos de las cinco llamadas de `PriceLabel`.
Es anterior a esta feature y no es un problema de formato. Queda anotado, no arreglado.

Nota relacionada: `PriceLabel` llama a `toValidNumber`, que hace `Number(` — pre-existente, es
lo que implementa el contrato del `₡0`, y ningún barrido money-safe alcanza
`components/shared/PriceLabel.tsx` (`liquidacion-money-safe.test.ts` mira
`components/shared/liquidacion/**` y los `lib/**` que casan `/[Ll]iquidacion/`).

## Verificación

| Comando | Resultado |
|---|---|
| `pnpm exec vitest run tests/components tests/integration tests/unit` | **1053 archivos, 13074/13074** |
| `pnpm exec vitest run tests/unit/guards tests/unit/descarga` | **51 archivos, 414/414** |
| `pnpm exec tsc --noEmit` | **limpio** |
| barrido final de `₡` | **0 formateadores vivos** (ver abajo) |

Casos añadidos en esta tanda: **24** — 21 de `PriceLabel.test.tsx` (nueve `it` + los siete del
`it.each` de ausencia + cinco más) y 3 de `moneda-formato.test.ts` (que pasa de 20 a 23).
`pnpm exec eslint` sobre los 10 archivos tocados → limpio.

**Un descuadre de UNO que no oculto**: la tanda C dejó escrito 13051 y aquí se miden 13074, es
decir +23 sobre 24 casos añadidos. Guardias y descarga siguen clavados en 414/414 y los 1053
archivos están en verde, así que no es un test perdido de esta tanda; el origen probable es que
la cifra de la tanda C se anotara antes de su última edición (su doc también dice «21 casos» de
`moneda-formato` donde el archivo tenía 20). **No lo perseguí**; lo dejo apuntado en vez de
redondear la resta para que cuadre.

### El barrido final

`grep -rn "₡" --include=*.ts --include=*.tsx app components lib | grep -v "lib/config/moneda.ts"`
deja **34 líneas, TODAS comentarios o docstrings**. No hay un solo formateador vivo.

Que sean comentarios no se afirmó a ojo: un script vuelve a barrer los mismos tres árboles tras
**quitar los comentarios** (el `quitarComentarios` de `tests/fixtures/money-safe.ts`), con
autocomprobación en las dos direcciones —que un `₡` en comentario desaparece y que un `₡` en un
literal vivo SÍ se ve— y da **0 líneas**.

Las 34 se reparten así, y todas son legítimas:

- **Prosa que cuenta el bug** (`₡13331832.72`, `₡13,331,832.72`, `₡1 234,5`): 20 líneas en los
  archivos migrados por las cuatro tandas. Nombrar el formato viejo es lo que hace que el
  comentario sirva para algo.
- **Prosa que cuenta el formato nuevo** (`₡9.999.999.999,99`, `-₡15.000,00`, `₡3.500,00`):
  9 líneas (topes de indemnización, toasts de `/wallet/tiendas`, `KpiValorAnimado`,
  `PanelConciliacion`, `IncidenteAdminService`, `tope-indemnizacion`).
- **Comentarios de columna** (`ordenes-columns.tsx:158,165,171` — «sin tarifa → ₡0»;
  `ranking-historico-descarga-columnas.ts:67` — «sin el «₡» de la pantalla»): 4 líneas que
  explican el contrato de la celda. La del ranking además documenta lo contrario de un formateo:
  que el XLSX lleva el monto CRUDO.
- **`DataTable.tsx:73`**: 1 línea, el porqué del `tabular-nums`.

Un mensaje de texto no formateable —del tipo «tecleá el monto, por ejemplo 12500.00»— no queda
ninguno con símbolo: los dos que había (los ejemplos de entrada de los avisos de tope) se
dejaron a propósito SIN `₡` en la tanda C, que es lo correcto para un campo que no admite
separador de miles.
