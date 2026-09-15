# Revisión — ficha 428 (los conmutadores de orden, solo con icono)

**Veredicto: OK, sin bloqueantes.** Revisado sobre `31cbd6d4..feat/428-orden-solo-icono`
(commits `c793c1eb` y `2a8837b3`), no sobre la bitácora.

## Lo que sostiene el veredicto: 8 mutaciones, 8 muertas

Ninguno de los tests nuevos es decorativo. El reviewer aplicó y revirtió:

| # | Mutación | Tests rojos |
| --- | --- | --- |
| M1 | `soloIcono = false` → `= true` (volverlo global) | 2 |
| M2 | quitar `aria-label={etiqueta}` | **27** |
| M3 | quitar `aria-pressed` en la rama de icono | 8 |
| M4 | `if (soloIcono && Icono)` → `if (soloIcono)` (botón vacío) | 1 |
| M5 | `<TooltipContent>{etiqueta}</TooltipContent>` → texto fijo | 6 |
| M6 | quitar `Icono` de una opción de campo | 4 |
| M7 | quitar un `soloIcono` de `OrdenesListado` | 4 |
| M8 | ignorar `soloIcono` (vuelve el texto) | 6 |

Además corrió 374 tests a mano —los 3 archivos de la ficha, `ordenes-listado-filtros`, y los
consumidores de `SegmentedToggle` (cierres, histórico, monitoreo, geografía)— todos verdes.

## Los seis puntos que se pidió apretar

1. **No-regresión de los otros 8 consumidores — CUMPLE.** `soloIcono` solo aparece en
   `SegmentedToggle.tsx` (declaración, JSDoc, default) y en `OrdenesListado.tsx` (dos usos,
   líneas 1264 y 1271). El diff toca 3 archivos de código y ninguno de los otros consumidores.
2. **Accesibilidad — CUMPLE.** Los cuatro botones llevan `aria-label`; el icono va
   `aria-hidden`; `aria-pressed` sigue en la rama de icono (M3 lo prueba); los nombres de grupo
   (`ETIQUETA_DIRECCION`, `ETIQUETA_CAMPO_ORDEN`) intactos. **El tooltip NO es el único portador
   del nombre** — M2 pone rojos 27 tests. Los botones siguen siendo hijos DIRECTOS del
   `ButtonGroup`, que es de lo que depende el redondeo de los extremos.
3. **Tests tautológicos — no queda ninguno.** El `queryByText` que habría quedado verde para
   siempre está corregido a `queryByRole`. Los dos `queryByText` que sobreviven NO son
   tautológicos: M8 los mata. Ningún `toEqual` compara contra la constante que genera el valor
   —las etiquetas van escritas a mano en los tres archivos de test—.
4. **El comentario reescrito — CUMPLE.** Describe lo que el código hace hoy, marca la frase
   revertida como histórica y escribe los dos costes aceptados. No queda ninguna frase
   defendiendo el texto sobre el icono.
5. **DESIGN.md — CUMPLE.** Cero hex, cero utilidades ad-hoc, cero `className` añadidos. El foco
   opaco se hereda de `buttonVariants`.
6. **Fallback — CUMPLE.** Una opción sin `Icono` cae al botón de texto (M4).

## Menores, ninguno bloquea

- **La red contra «volverlo global» es una sola, y conviene saberlo.** Con M1 los tests de las
  OTRAS pantallas siguieron VERDES: localizan por nombre accesible, y el `aria-label` se lo
  preserva. Quien avisa es únicamente `segmented-toggle-solo-icono.test.tsx`. Existe y funciona;
  simplemente no hay segunda línea.
- El `conteo` se pierde en silencio con `soloIcono`. Está en el JSDoc y anclado con un test; hoy
  ningún consumidor combina las dos cosas. Deuda declarada, no defecto.
- El tooltip es puramente visual: base-ui no cablea `aria-describedby`. Como su texto ES el
  `aria-label`, un lector de pantalla no pierde nada ni hay doble anuncio. No pide cambio.

## CHECKPOINTS.md

Especificación y trazabilidad `R<n>`: **N/A** (`sdd:false`). typecheck / lint / tests: **verdes**.
E2E: no aplica —no toca auth, pagos, recaudo, ingesta ni webhooks, y el repo no tiene harness—.
RLS, migraciones, `down.sql`, secretos, webhooks: **N/A**, el diff es 100 % de presentación.
Capas: OK. Permisos y multi-país: N/A.

## Lo que este verde NO cubre

- **Los píxeles.** La suite corre en jsdom, sin CSS. La comprobación visual la hizo el humano
  sobre la rama y la dio por buena («listo ya quedó»).
- Sin `DATABASE_URL` se saltaron 183 archivos de `integration/db`. Irrelevante aquí: el diff no
  toca servicios, esquema ni consultas.
