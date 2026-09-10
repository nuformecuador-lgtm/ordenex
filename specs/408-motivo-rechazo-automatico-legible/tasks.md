# 408 — Tareas

Zona `frontend`. Nada de `db/`, nada de `lib/`, nada de `feature_list.json`.
Preguntas abiertas: **ninguna** (las tres se cerraron el 2026-09-10, ver `requirements.md`).

⚠️ **El gate de esta ficha es `./init.sh` completo.** Los archivos llevan `cierre` en el nombre, que
está en la lista de nombres de dinero: `--rapido` se niega por diseño (`docs/verification.md`).
Contar con ~4 minutos, no con 1.

⚠️ **El fallo mudo de esta ficha tiene nombre:** pasar el booleano equivocado en `/cierre-dia`. Nadie
ve un error —sólo un texto más corto— y el mensajero se queda sin saber que el rechazo no fue suyo.
T7 y la mutación 6 existen para eso.

---

- [ ] **T1 — El traductor, en el módulo puro.** En `cierre-labels.ts`:
  `MOTIVO_RECHAZO_AUTOMATICO_COLA` y
  `motivoGestionLegible(motivo: string | null, hayMarcadorDeOrigen: boolean): string | null`, con el
  contrato de `design.md` §3 — igualdad exacta contra las tres cadenas compuestas desde
  `CAUSA_DEVOLUCION_SEED`, etiquetas de `CAUSA_DEVOLUCION_LABEL`, `null` → `null`, cualquier otra
  cosa → la entrada idéntica, y la cola sólo cuando `hayMarcadorDeOrigen === false`. Comentario corto
  con las tres razones: por qué la igualdad es exacta, por qué `null` no se vuelve `"—"` y por qué
  hay dos variantes.
  **Hecho:** `pnpm run typecheck` verde y `cierre-labels.ts` sigue sin importar React (comprobado
  leyendo sus imports: sólo `lib/types/*` y `causa-devolucion-options`, que también es puro).

- [ ] **T2 [P] — Tests del traductor.** `tests/unit/components/motivo-rechazo-automatico-legible.test.ts`:
  R1 (tres causas, literales a mano), R2 (texto libre, plantilla dentro de una frase, cadena vacía,
  otra caja — **cada caso con las dos variantes**), R3 (`null` → `null`), R5 (causa desconocida →
  entrada idéntica), R7 (objeto congelado sin mutar + dos llamadas iguales), R11 (texto largo
  completo, literal a mano), R12 (el largo contiene el corto).
  *Depende de:* T1. *Paralelo con:* T3.
  **Hecho:** verde, y la mutación 1 de `design.md` §6 los pone en rojo. Anotar cuántos.

- [ ] **T3 [P] — La guardia de jerga.** `tests/unit/guards/motivo-automatico-sin-jerga.guardia.test.ts`:
  para cada valor de `CAUSA_DEVOLUCION_SEED` y **para las dos variantes**, la salida sobre
  `escalado SLA <causa>` no contiene `"SLA"` ni el value en inglés. **Sobre la salida, jamás con un
  `grep` del código fuente.**
  *Depende de:* T1. *Paralelo con:* T2.
  **Hecho:** verde, y roja con la mutación 1. Si el enum gana un cuarto valor, esta guardia lo
  destapa sola.

- [ ] **T4 [P] — Admin: pantalla y comprobante.** Las cuatro columnas de
  `cierre-detalle-shared.tsx` (1385, 1424, 1433, 1455) y `cierre-factura.tsx:1530`, todas con
  `motivoGestionLegible(g.motivo, g.esRechazoSla)`. El `?? "—"` se queda en el render.
  *Depende de:* T1. *Paralelo con:* T5, T7.
  **Hecho:** typecheck verde; T6 en verde.

- [ ] **T5 [P] — Admin: las dos descargas.** `cierre-gestiones-descarga-columnas.ts` (215, 240, 277,
  315) y `cierres-gestiones-fundida-descarga-columnas.ts:445`, mismo argumento.
  *Depende de:* T1. *Paralelo con:* T4, T7.
  **Hecho:** typecheck verde; T8 en verde.

- [ ] **T6 — Test de la fila del admin.** `tests/components/CierreMotivoRechazoAutomatico.test.tsx`:
  gestión `rechazada` con `esRechazoSla: true` y `motivo: "escalado SLA wrong_address"`. Afirma
  (a) celda «Motivo» exactamente `"Dirección errada"`, (b) marcador `"Automático"` presente con su
  nota literal completa, (c) la celda «Motivo» **no** contiene `"automático"` ni la nota del
  marcador. Segunda fila con motivo libre del mensajero, que sale intacto.
  *Depende de:* T4.
  **Hecho:** verde; con la mutación «pintar en Motivo la frase del marcador», el aserto (c) rojo.

- [ ] **T7 [P] — `/cierre-dia`: pantalla y descarga (OBLIGATORIA).** Las cuatro columnas de
  `CierreDiaModule.tsx` (1195, 1203, 1223, 1231) y las cuatro celdas de
  `cierre-dia-descarga-columnas.ts` (164, 178, 193, 216), con **el mismo** `g.esRechazoSla` — que en
  esta vista es siempre `false` (`CierreDiaRepository.ts:295`) y por eso resuelve a la variante
  larga. Los dos archivos ya importan de `cierre-labels`: se añade el símbolo al import existente, no
  se estrena dependencia.
  *Depende de:* T1. *Paralelo con:* T4, T5.
  **Hecho:** typecheck verde; T9 en verde.

- [ ] **T8 — Tests de las descargas del admin.** Ampliar
  `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts` (R6 y R3: celda vacía, no `"—"`) y
  `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` (R6). Literales a mano.
  *Depende de:* T5.
  **Hecho:** verdes; las mutaciones 3 y 4 los ponen en rojo.

- [ ] **T9 — Tests de `/cierre-dia`.** `tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx`
  (R11: la fila del mensajero muestra el texto **largo**, literal completo a mano) y ampliación de
  `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` (R6 con la variante larga).
  *Depende de:* T7.
  **Hecho:** verdes; y la **mutación 6** —pasar `true` fijo en estos llamadores— los pone en rojo.
  Si no enrojece, el test no está midiendo lo que dice.

- [ ] **T10 — Las siete mutaciones de `design.md` §6.** Una a una sobre el árbol: correr los tests
  relacionados, anotar **cuántos rojos** produce cada una, revertir.
  *Depende de:* T2, T3, T6, T8, T9.
  **Hecho:** siete filas en `progress/impl_408.md` con su número de rojos. Ninguna con cero. Si un
  arnés de mutaciones dice «superviviente» sin haber ejecutado un test, no vale: se comprueba a mano.

- [ ] **T11 — Gate y trazabilidad.** `./init.sh` completo (el rápido se niega, ver arriba), con
  `INIT_EXIT=$?` **escrito dentro del log**. Mirar los `skipped`, no sólo el veredicto. Volcar en
  `progress/impl_408.md` la tabla `R1..R12 → test` y la salida real.
  *Depende de:* T10.
  **Hecho:** gate verde contra el baseline, los doce requisitos mapeados a un test que existe y pasa,
  y todo commiteado — verificando el blob en la rama, no sólo el árbol.
