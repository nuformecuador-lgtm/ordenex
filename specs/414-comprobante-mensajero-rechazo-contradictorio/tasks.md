# 414 — Tareas

Zona `frontend`. **Tres archivos de producción**, todos en `app/`:
`cierres-admin/_components/cierre-factura.tsx` (el cambio), `cierres-admin/_components/cierre-labels.ts`
y `cierres-admin/_components/cierre-detalle-shared.tsx` (los dos textos que se mudan), más
`cierre-dia/_components/CierreDiaModule.tsx`, que deja de declararlos.
Nada de `lib/`, nada de `db/`, nada de `feature_list.json`, nada de `progress/` ajeno.
**Preguntas abiertas: ninguna** — las tres las cerró el humano el 2026-09-10 (`requirements.md`).

⚠️ **El gate es `./init.sh` COMPLETO.** Los archivos llevan `cierre` en el nombre: `--rapido` se niega
por diseño (`docs/verification.md`). ~4 minutos, y hay que mirar los `skipped`.

⚠️ **Dos fallos mudos, con nombre y apellido:**
1. un test de ausencia con la fila **plegada** pasa en verde sin el arreglo, porque el bloque sólo
   existe con la fila abierta (`cierre-factura.tsx:1474`) → T5 y la mutación 8;
2. anidar la marca «La tienda» dentro del fragmento `g.resultado === "rechazada"` deja **muda una
   entrega** registrada por la tienda, sin romper nada visible → T4 y la mutación 5.

---

- [ ] **T1 — Mudar los dos textos de «La tienda» al módulo puro.**
  Declarar `GESTION_TIENDA_BADGE_LABEL` y `GESTION_TIENDA_BADGE_NOTA` en `cierre-labels.ts` con el
  **mismo texto, carácter por carácter**; añadir los dos nombres al bloque de re-exportación de
  `cierre-detalle-shared.tsx:125-174`; borrar las declaraciones de `CierreDiaModule.tsx:1079-1087` y
  añadir los dos nombres a su import de `cierre-labels` ya existente (`:58-65`). **No** importar de
  `CierreDiaModule` hacia `cierre-factura`: sería un ciclo (`design.md` §4).
  *Depende de:* nada.
  **Hecho:** `pnpm run typecheck` verde, `cierre-labels.ts` sigue sin importar React, y
  `tests/components/CierreDiaModule.test.tsx` (que afirma esos textos en la tabla en vivo) **verde sin
  tocarlo**.

- [ ] **T2 — Declinar el distintivo de origen para la audiencia del mensajero.**
  En `FilaGestion`, envolver **sólo** el `<span>` del badge (`:1548-1566`) en `esMensajero ? null : (…)`.
  El `DatoFila` de «Ingreso de bodega por rechazos» (`:1540-1547`) **no se toca**. Rótulos y notas del
  origen, sin cambiar ni un carácter. Comentario corto con el porqué (`CierreDiaRepository.ts:295`) y
  con que ésta es la única condición a cambiar si se reabre la 102.
  *Depende de:* nada. *Paralelo con:* T1.
  **Hecho:** typecheck verde; `git diff --stat` sin un solo archivo de `lib/` ni de `db/`.

- [ ] **T3 — El argumento del motivo dice la verdad por construcción.**
  En `:1536`, `motivoGestionLegible(g.motivo, !esMensajero && g.esRechazoSla)`. No se toca
  `cierre-labels.ts` ni la firma de la función.
  *Depende de:* T2 (mismo archivo, misma lectura).
  **Hecho:** typecheck verde; para el admin la salida es idéntica a la de antes, lo comprueba T7 con
  los tests existentes sin modificarlos.

- [ ] **T4 — Pintar la marca «La tienda» en el comprobante del mensajero.**
  En el bloque desplegado de `FilaGestion` (`{open ? … : null}`, `:1474`) y **FUERA del fragmento
  `g.resultado === "rechazada"`**, condicionada a `esMensajero && g.desdeAyudaTienda`, con el mismo
  `Badge variant="secondary"` + `title` + `aria-label` que la tabla en vivo. Los textos se **importan**
  por la puerta de T1; **prohibido teclearlos aquí**.
  Comentario corto con los dos porqués de `design.md` §3(c): fuera del fragmento porque
  `desdeAyudaTienda` es ortogonal al resultado, y en el bloque desplegado —y no pegado a la guía, como
  en la tabla en vivo— porque ahí la celda vive dentro de un `<button>` con `aria-label` propio y la
  nota no se anunciaría.
  *Depende de:* T1, T2.
  **Hecho:** typecheck verde; T5 en verde con sus dos resultados.

- [ ] **T5 [P] — Test del comprobante: las dos audiencias, las dos marcas.**
  `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx` (nuevo). Render directo de
  `CierreFacturaDetalle` con gestiones construidas a mano. Cubre R1 (mensajero, sin distintivo), R2
  (admin, los dos rótulos con sus dos notas), R3 (el renglón del ingreso y el motivo largo siguen), R4
  (los tres estados, incluido el caso 3 declarado como contrato del componente), R7 (**una `entregada`
  y una `rechazada`**, las dos con `desdeAyudaTienda: true`) y R8 (ausencia emparejada + audiencia
  admin sin la marca).
  **Cada caso de ausencia despliega la fila y lo demuestra** afirmando primero algo que sólo existe con
  la fila abierta. Todos los literales tecleados a mano; prohibido importar `RECHAZO_*_BADGE_*`,
  `GESTION_TIENDA_BADGE_*` o `motivoGestionLegible` en el test.
  *Depende de:* T3, T4. *Paralelo con:* T6.
  **Hecho:** verde, y las mutaciones 1, 2, 3, 4, 5 y 6 de `design.md` §9 lo ponen rojo — cada una con
  su número anotado.

- [ ] **T6 [P] — Test de la pantalla real del mensajero (composition root + un solo texto).**
  `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx` (nuevo). Monta `CierreDiaModule`,
  copiando la receta de mocks de `tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx:27-53` y
  añadiendo `verCierrePasado` al mock de `@/lib/actions/cierre-dia`; un cierre pasado en el listado,
  abrirlo, desplegar la fila del rechazo del cron y repetir las aserciones de R1 (R5). En el MISMO
  montaje, una gestión pendiente con `desdeAyudaTienda: true` en la tabla en vivo y otra en el
  comprobante: el rótulo y la nota, tecleados **una sola vez** en el test, se afirman en las dos (R9).
  *Depende de:* T3, T4. *Paralelo con:* T5.
  **Hecho:** verde, y rojo con las mutaciones 1 y 7. **Si el modal no se puede conducir en jsdom, NO se
  degrada a un grep del código fuente:** se anota el bloqueo en `progress/impl_414.md` y se le dice al
  leader. Un aserto sobre el texto del archivo mide escritura, no comportamiento, y lo que se quiere
  comprobar es que la pantalla **pasa** `audiencia="mensajero"`.

- [ ] **T7 — No-regresión, sin tocar los tests ajenos.**
  Correr `CierreMotivoRechazoAutomatico.test.tsx`, `CierresAdminModule.test.tsx`,
  `CierreDiaModule.test.tsx`, `CierreDiaMotivoRechazoAutomatico.test.tsx`, `CierreFacturaPapel.test.tsx`,
  `CierreDetallePagos.test.tsx`, `CierreFacturaSinGestionar.test.tsx`, los tres de
  `tests/unit/descarga/` y las guardias de `cierre-*`.
  *Depende de:* T4.
  **Hecho:** todos verdes **sin haberlos editado** — `git diff --numstat` con **0 líneas** en esos
  archivos. Si alguno exige un cambio, es señal de que T1/T2/T4 se pasaron de largo: se arregla el
  código, no el test (lección «literal: contrato o polizón»).

- [ ] **T8 — Las ocho mutaciones de `design.md` §9.**
  Una a una sobre el árbol: aplicar, correr los tests de la ficha, anotar **cuántos rojos y en qué
  archivos**, revertir con `git checkout -- app/ tests/`. La 8 es la autocomprobación del test: debe
  salir **verde** y demuestra que el control de no-vacuidad es lo único que impide el falso verde.
  *Depende de:* T5, T6, T7.
  **Hecho:** ocho filas en `progress/impl_414.md` con su número. Ninguna de las siete primeras con cero
  rojos.

- [ ] **T9 — Gate y trazabilidad.**
  `./init.sh` completo (el rápido se niega, ver arriba), con `INIT_EXIT=$?` **escrito dentro del log**,
  sin canalizar por `tail`. Veredicto contra `tests/baseline-rojos.json`; revisar los `skipped`.
  Volcar en `progress/impl_414.md` la tabla `R1..R9 → test`, la salida real y las ocho mutaciones.
  *Depende de:* T8.
  **Hecho:** gate verde contra el baseline, los nueve requisitos mapeados a un test que existe y pasa, y
  **todo commiteado y verificado en el blob de la rama**, no sólo en el árbol de trabajo.
