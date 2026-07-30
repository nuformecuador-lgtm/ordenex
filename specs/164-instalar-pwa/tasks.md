# Feature 164 — Botón de instalar la PWA y screenshots · tasks

## T1 — Botón
- [x] **T1.1** `hooks/useInstalarPwa.ts`: captura `beforeinstallprompt` + `appinstalled`,
      `preventDefault`, oferta de un solo uso, fallo del diálogo tragado.
- [x] **T1.2** `components/shared/InstalarPwaButton.tsx`: `null` sin oferta, variante
      `soloIcono` con nombre accesible completo.
- [x] **T1.3** Montaje en `components/shared/PageHeader.tsx` (icono < `sm`, con texto ≥ `sm`).

## T2 — Screenshots
- [x] **T2.1** Capturar con Playwright, contra la app corriendo, ocultando el indicador de
      desarrollo de Next. **Hecho**: 3 PNG reales, revisados a ojo uno a uno.
- [x] **T2.2** Declararlas en `public/manifest.json` con `form_factor`, `sizes` y `label`.

## T3 — Guardia del manifest
- [x] **T3.1** `tests/unit/pwa/manifest.test.ts` (no existía ninguna).

## T4 — Tests (trazabilidad R → test)

| R | Test |
|---|---|
| R1 | `InstalarPwaButton.test.tsx` › no se pinta mientras el navegador no ofrezca instalar |
| R2 | `InstalarPwaButton.test.tsx` › aparece cuando el navegador ofrece instalar |
| R3 | `InstalarPwaButton.test.tsx` › impide el aviso propio del navegador |
| R4 | `InstalarPwaButton.test.tsx` › al pulsarlo abre el diálogo nativo |
| R5 | `InstalarPwaButton.test.tsx` › tras usar la oferta desaparece · si el usuario rechaza, tampoco se le insiste |
| R6 | `InstalarPwaButton.test.tsx` › si el diálogo nativo falla, no propaga el error |
| R7 | `InstalarPwaButton.test.tsx` › cuando la app queda instalada el botón desaparece sin pulsarlo |
| R8 | `InstalarPwaButton.test.tsx` › la variante de solo icono conserva el nombre accesible |
| R9 | `InstalarPwaButton.test.tsx` › deja de escuchar al desmontarse |
| R10 | `manifest.test.ts` › declara los campos que el navegador exige |
| R11 | `manifest.test.ts` › incluye los iconos de 192 y 512 |
| R12 | `manifest.test.ts` › cada recurso existe en `public/` |
| R13 | `manifest.test.ts` › cada recurso mide lo que declara |
| R14 | `manifest.test.ts` › hay al menos una para móvil y una para escritorio |
| R15 | `manifest.test.ts` › todas las de móvil comparten proporción |
| R16 | `manifest.test.ts` › todas llevan etiqueta descriptiva |
| R17 | `manifest.test.ts` › ninguna excede 3840px ni baja de 320 |
| R18 | Revisión visual de las 3 capturas antes de declararlas (design §1.3). **Los tests NO lo cubren**: que una imagen sea "de verdad la app" no es automatizable aquí. |

- [x] **T4.1** `tests/components/InstalarPwaButton.test.tsx` (R1–R9).
- [x] **T4.2** `tests/unit/pwa/manifest.test.ts` (R10–R17).

## T5 — Verificación
- [x] **T5.1** 27 tests propios verdes. `pnpm lint` 0 errores; `pnpm typecheck` limpio salvo
      los 2 errores previos de los `_Tmp*` sin commitear.
- [x] **T5.2** Suite completa: 18 rojas, **las mismas que antes de esta feature** → cero
      regresiones.
- [x] **T5.3** **6 mutaciones, las 6 muertas**: screenshot con dimensiones mentidas (1 rojo),
      screenshot inexistente (2), proporciones narrow distintas (2), `display: browser` (1),
      hook sin `preventDefault` (1), oferta sin descartar tras usarla (3).
- [ ] **T5.4** SIN HACER, y no se puede hacer en local (design §0): ver el botón aparecer y el
      diálogo de instalación real. Exige despliegue, túnel o un hostname que no sea
      `localhost` —`pnpm build && pnpm start` **tampoco** vale, porque `sw.js` se autodestruye
      en localhost.
- [ ] **T5.5** SIN HACER: comprobar en iPhone que, al no haber botón, el mensajero encuentra
      "Compartir → Añadir a pantalla de inicio". Si no lo encuentra, hace falta una ayuda
      propia (fuera de alcance de esta feature).

## T6 — Aviso de arné
- [ ] **T6.1** Con el alta de 164 la zona `frontend` queda con **tres** features
      `in_progress` (161, 163, 164) y la regla 1 admite **dos**: `./init.sh` falla en esa
      comprobación hasta que se cierre alguna. **Decisión del humano**, no del agente: se
      registró la feature y se avisó, en vez de dejarla sin registrar o de marcar otra como
      `done` sin haberla mergeado.
