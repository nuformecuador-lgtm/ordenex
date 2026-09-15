# Implementación — ficha 428: los conmutadores de orden, solo con icono

**Rama:** `feat/428-orden-solo-icono` · **PR:** #797 (merge `a42d1699`) · **`sdd: false`**

## Por qué no hay mapa `R<n> -> test`

`CHECKPOINTS.md > Trazabilidad` pide ese mapa para las fichas SDD. Esta es `sdd: false`: no hay
`specs/428-*/requirements.md` ni requisitos EARS numerados que mapear. Lo que sigue es el
equivalente: **cada decisión de la ficha, con el test que la sostiene y la mutación que lo mata.**
Se deja escrito para que la ausencia del mapa sea una decisión declarada y no un olvido.

## Qué cambia, y el test que lo ancla

| Decisión | Test | Mutación que lo mata |
| --- | --- | --- |
| `soloIcono` es opt-in: default `false` | `segmented-toggle-solo-icono.test.tsx` | M1 (`= true`) → 2 rojos |
| La etiqueta se muda al `aria-label`, no desaparece | 27 casos en los 3 archivos | M2 (quitar `aria-label`) → 27 rojos |
| El estado seleccionado sigue anunciándose | `segmented-toggle-solo-icono.test.tsx` | M3 (quitar `aria-pressed`) → 8 rojos |
| Una opción sin `Icono` cae al texto, nunca botón vacío | `segmented-toggle-solo-icono.test.tsx` | M4 (`if (soloIcono)`) → 1 rojo |
| El tooltip dice la etiqueta, no un texto fijo | `segmented-toggle-solo-icono.test.tsx` | M5 → 6 rojos |
| Toda opción de orden declara `Icono` (guardia) | `ordenamiento-ordenes.test.ts` | M6 → 4 rojos |
| `/ordenes` lo pasa en los DOS conmutadores | `ordenes-listado-orden.test.tsx` | M7 → 4 rojos |
| Con `soloIcono` no queda texto visible | `ordenes-listado-orden.test.tsx` | M8 → 6 rojos |

## Archivos

Código (3): `components/shared/SegmentedToggle.tsx` · `app/(app)/ordenes/_components/OrdenesListado.tsx` ·
`app/(app)/ordenes/_components/ordenamiento-ordenes.ts`
Tests (3): `segmented-toggle-solo-icono.test.tsx` (nuevo, 13 casos) ·
`ordenes-listado-orden.test.tsx` (+6) · `ordenamiento-ordenes.test.ts` (+3)

## Dos tests existentes que hubo que tocar, y por qué no es aflojar la red

1. **Dos `toEqual` literales** leían `b.textContent`. Con solo-icono el `textContent` es `""` por
   diseño, así que pasan a leer `aria-label`. El contrato que anclan —son ESTAS dos opciones, en
   este orden— no cambia, y los valores esperados siguen escritos a mano en el test, no importados
   del módulo que los genera. Si alguien cambia el texto, siguen poniéndose rojos.
2. **`queryByText("Más recientes")` → `queryByRole("button", { name })`.** Ese caso comprobaba que
   al pasar a remisión ya no queda «Más recientes». Por texto habría dado `null` SIEMPRE desde esta
   ficha: verde para siempre, incapaz de ponerse rojo. Lo que se comprueba ahora es que no queda un
   BOTÓN con ese nombre.

## Lo que este trabajo NO cubre

- **Los píxeles.** La suite corre en jsdom, sin CSS: ningún test sabe si «Filtros» vuelve a la
  primera línea. Lo verificó el humano abriendo la pantalla.
- **La red contra «volverlo global» es una sola.** Con el default en `true`, los tests de las otras
  pantallas siguen VERDES —localizan por nombre accesible, que se preserva—. Quien avisa es solo
  `segmented-toggle-solo-icono.test.tsx`.
- El `conteo` no se pinta con `soloIcono`. En el JSDoc y anclado con un test; ningún consumidor
  combina hoy las dos cosas.

## Los dos costes que el humano aceptó, con los números delante

Los conmutadores ocupaban **~800 px de los ~1480** de la fila y empujaban «Filtros» a una tercera
línea. A cambio de recuperarlos: (a) en móvil no hay hover, así que los iconos quedan mudos; (b) las
MISMAS dos flechas significan «Más recientes/Más antiguas» con fecha y «Más altas/Más bajas» con
remisión, y nada en pantalla lo dice. Se le ofrecieron dos variantes más conservadoras —activo con
texto e inactivo en icono; y solo el campo en icono— y las descartó. **No reproponer.**
