# Feature 417 — tareas

Zona: **backend**. Complejidad: **baja**. Sin migración, sin UI, sin endpoint nuevo.
`[P]` = paralelizable con la tarea anterior (archivos distintos).

**Un commit por tarea lógica** (`docs/conventions.md`): `feat(417)` / `test(417)` / `docs(417)`.
**Marca la casilla al terminarla.** Una lista entera en blanco hace indistinguible «no hecha» de
«no anotada» — fue el único bloqueante de la 409.

---

## T0 — Pre-vuelo (10 min, sin escribir código)

- [ ] **T0.1** Releer en el **archivo real** (no en el grafo: devuelve símbolos ya borrados):
  `lib/services/VigenciaAvisoAgregadoService.ts`, `tests/unit/services/vigencia-aviso-agregado.test.ts`,
  `lib/services/NotificacionService.ts` (`cifrasVivas`) y
  `lib/repositories/AvisoAgregadoRepository.ts` (`contarRepresadas`).
  **Hecho cuando:** confirmas las cinco anclas de `requirements.md` §Verificado y, si alguna se
  movió, lo anotas en `progress/impl_417_backend.md` **antes** de tocar nada.
- [ ] **T0.2** Confirmar que el caso mal nombrado sigue en el archivo (líneas 83-92 hoy) y que su
  aserto es `toBeNull()`.
  **Hecho cuando:** está citado literal en la bitácora. Si ya no existe, **para y pregunta**: la
  ficha cambia de forma.
- [ ] **T0.3** Confirmar el hecho que sostiene R3/R4: `novedades_sin_gestionar` tiene **un solo
  productor** (`lib/notificaciones/notificadores.ts:371` → `emitir.ts:1041-1062`), emite siempre a
  `{ rol: "adminTienda", tiendaId }` y el catálogo declara `destinatarios: ["adminTienda"]`.
  **Hecho cuando:** los tres están verificados en el archivo real. **Si apareciera un segundo
  productor o un destinatario de otro rol, para y dilo**: la guarda de T1.2 cambiaría de forma.

---

## T1 — Las dos guardas en el seam (R1, R2, R3, R4) · depende de T0

- [ ] **T1.1** En `VigenciaAvisoAgregadoService.cifra`, rama `devoluciones_represadas`: si el rol es
  `adminSatelite` y su zona no es un id útil (ausente, `null` o `""`), **no llamar al repositorio** y
  lanzar un error que **nombre la causa** (`sin zona asignada`) y el evento. Los demás caminos,
  intactos. Comentario al lado con **el porqué**, no con el qué.
  **Hecho cuando:** `pnpm run typecheck` y `pnpm run lint` pasan, y la rama de `maestro`/`admin` no
  ha cambiado ni una línea.
- [ ] **T1.2** En la rama `novedades_sin_gestionar` del **mismo método**: si el rol **no** es
  `adminTienda`, **no llamar al repositorio** y lanzar un error que nombre la causa. Mismo criterio
  que T1.1 —*si el ámbito del actor no existe, se falla; no se inventa uno*—, y por eso van en el
  mismo commit conceptual.
  **Hecho cuando:** `typecheck` y `lint` pasan y la rama del `adminTienda` legítimo no cambia.
- [ ] **T1.3 `[P]`** Ampliar la documentación de `lib/interfaces/services/IVigenciaAvisoAgregado.ts`
  con los **dos casos nuevos de lanzamiento**, junto al que ya declara para un evento no agregado.
  **Hecho cuando:** el contrato no dice menos de lo que la implementación hace. Sin cambio de firma.

---

## T2 — Los tests del seam: derogar el mal nombrado y afirmar las dos guardas (R1, R2, R3, R4) · depende de T1

- [ ] **T2.1** En `tests/unit/services/vigencia-aviso-agregado.test.ts`, sustituir el caso
  «un adminSatelite SIN zona no ve el total…» por casos que afirmen lo que su nombre promete:
  el repositorio **no se llama** (R1) y el resolutor **lanza con el nombre de la causa** (R2).
  **Tres formas del mismo estado**, porque `Actor.zonaId` es opcional: `null`, **ausente** y `""`.
  **Hecho cuando:** los casos pasan, el literal del mensaje está **escrito a mano** (nunca importado
  de producción) y la derogación queda **explicada en un comentario** en el propio archivo —por qué
  el aserto viejo era falso, no sólo que cambió.
- [ ] **T2.2** Casos nuevos del **espejo** (R3, R4) en el mismo archivo: para un actor que no sea
  `adminTienda` pidiendo `novedades_sin_gestionar`, el repositorio **no se llama** y el resolutor
  **lanza con el nombre de la causa**. Al menos **dos roles** (`maestro` y `adminSatelite`), porque
  el fallo silencioso de hoy es el mismo para los dos.
  **Hecho cuando:** pasan, el literal está escrito a mano y **ninguno afirma `0`**: un `0` es
  exactamente lo que la ficha prohíbe.
- [ ] **T2.3** Verificar que **ningún caso ajeno** del archivo se tocó.
  **Hecho cuando:** `git diff` de ese archivo muestra sólo el bloque derogado (T2.1) y los añadidos;
  los casos de R5, R6 y R7 salen **intactos** en el diff.

---

## T3 — No regresión (R5, R6, R7) · depende de T1 · `[P]` con T4

- [ ] **T3.1** Ejecutar los **tres** casos vigentes **sin editarlos**: «se pide con la ZONA del
  adminSatelite» (R5), «maestro y admin lo piden GLOBAL (`null`)» (R6) y «`novedades_sin_gestionar`
  se pide con el usuarioId de la tienda» (R7).
  **Hecho cuando:** los tres pasan y su diff está **vacío**. Son el control positivo de la ficha: si
  alguna guarda dispara de más, se ponen rojos (mutaciones M3 y M5).

---

## T4 — Dónde aterriza el fallo (R9) · depende de T1

- [ ] **T4.1** Caso nuevo en `tests/unit/services/notificacion-service.test.ts`: `NotificacionService`
  con el resolutor **real** (`VigenciaAvisoAgregadoService` + repositorio espía), un actor
  `{ rol: "adminSatelite", zonaId: null }` y una fila de `devoluciones_represadas`.
  Debe afirmar **las dos mitades**: el aviso **sale en el listado y sin número**, y el **logger
  recibe el error** con la causa nombrada.
  **Hecho cuando:** el caso pasa, usa el `vigenciaFake` **sólo** donde no estorbe (aquí hace falta el
  resolutor de verdad) y **ningún caso existente del archivo cambia**.
  **Basta UNO, y por qué:** los dos fallos nuevos aterrizan en el **mismo** `catch` de
  `cifrasVivas`, así que un segundo caso para el espejo probaría la misma línea. R3/R4 ya tienen su
  rojo propio en T2.2 y en M4.

> **Nota de honestidad, que va también en la bitácora:** este caso construye a mano un estado que hoy
> el predicado de la 146 no deja llegar. Es deliberado: se está probando una **defensa en
> profundidad**, no un camino alcanzable (`design.md` §9.6).

---

## T5 — El predicado de la 146 no se toca (R8) · `[P]` desde T0

- [ ] **T5.1** Comprobar por **diff**, no por palabra, que salen vacíos:
  `lib/repositories/NotificacionRepository.ts` y `tests/unit/repositories/notificacion-visibilidad.test.ts`.
  **Hecho cuando:** `git diff --stat dev...HEAD -- <esos dos>` sale **vacío** y la suite de
  visibilidad de la 146 pasa **sin haberse editado**. Pegado en la bitácora.

---

## T6 — Las mutaciones: el entregable de la ficha · depende de T2, T3, T4

Árbol limpio antes y después de cada una (`git status --short`), y la salida **pegada** en
`progress/impl_417_backend.md` con el conteo exacto de rojos.

- [ ] **T6.1 — M1 (la que da sentido a la ficha).** Retirar la guarda de la zona y dejar
  `actor.zonaId ?? null`.
  **Hecho cuando:** se ponen **rojos R1, R2 y R9**, y lo hacen **con el predicado de la 146
  intacto** (no se toca `NotificacionRepository.ts` durante la mutación). Si sale verde, la ficha
  **no ha hecho nada** y hay que volver a T2.
- [ ] **T6.2 — M2.** Sustituir ese lanzamiento por `return 0`.
  **Hecho cuando:** se pone **rojo R2** (y R9: el aviso desaparecería en vez de mostrarse sin
  número). Demuestra que la ficha exige **ruido**, no silencio.
- [ ] **T6.3 — M3 (control positivo).** Hacer que la guarda de la zona dispare **siempre** para
  `adminSatelite`.
  **Hecho cuando:** se pone **rojo R5**. Demuestra que los casos de R1/R2 no están verdes por vacío.
- [ ] **T6.4 — M4 (el espejo).** Retirar la guarda de rol de la rama `novedades_sin_gestionar`.
  **Hecho cuando:** se ponen **rojos R3 y R4**, también con el predicado de la 146 intacto. Si sale
  verde, el espejo quedó sin alarma propia y la reparación está a medias.
- [ ] **T6.5 — M5 (control positivo del espejo).** Hacer que la guarda de rol dispare **siempre**.
  **Hecho cuando:** se pone **rojo R7**.
- [ ] **T6.6** Revertir las cinco y confirmar árbol limpio.
  **Hecho cuando:** `git diff --numstat` sale vacío respecto del estado previo a T6.

---

## T7 — Gate y cierre · depende de T6

- [ ] **T7.1** `./init.sh --rapido`, con `INIT_EXIT=$?` escrito **dentro** del log y **sin canalizar
  por `tail`**.
  **Hecho cuando:** el log dice `INIT_EXIT=0`, y los `skipped` se miran uno a uno (no sólo el exit
  code). Este diff **no** toca cimientos, así que el rápido **no debe negarse**; si se niega, algo se
  tocó de más — léelo antes de correr el completo.
- [ ] **T7.2** `progress/impl_417_backend.md` con: el mapa `R<n> → test` de abajo, la salida de las
  tres mutaciones, el diff vacío de T5 y las desviaciones si las hubo.
  **Hecho cuando:** existe **y está commiteado** (tres veces en un día se quedó sin commitear en este
  repo), y el blob commiteado se ha verificado en la rama.
- [ ] **T7.3** Marcar en este archivo **todas** las casillas ejecutadas y dejar sin marcar las que no,
  **con el motivo en la propia línea**.
  **Hecho cuando:** no queda ninguna casilla ambigua.

---

## T8 — Opcional, NO bloqueante

- [ ] **T8.1 `[P]`** Medir en producción, **en solo lectura**, cuántos `usuario` con rol
  `adminSatelite` tienen `zona_id IS NULL`, y decir el número en la bitácora.
  **Hecho cuando:** el número está escrito, o está escrito que **no se pudo medir y por qué**.
  **No bloquea el despliegue** y no cambia ni una línea del diseño (`design.md` §10): la guarda es la
  misma exista o no ese usuario. Es información, no puerta.

---

## Trazabilidad `R<n> → test`

| R | Qué exige | Test concreto |
| --- | --- | --- |
| **R1** | sin zona → no se consulta ningún ámbito | `tests/unit/services/vigencia-aviso-agregado.test.ts` › el repositorio **no se llama** para `{adminSatelite, zonaId: null / ausente / ""}` (T2.1) |
| **R2** | sin zona → falla **nombrando** la causa | mismo archivo › `rejects.toThrow(/sin zona/i)` con el literal escrito a mano (T2.1) |
| **R3** | rol que no es tienda → no se cuenta con su id | mismo archivo › el repositorio **no se llama** para `maestro` y `adminSatelite` en `novedades_sin_gestionar` (T2.2) |
| **R4** | ese caso **falla nombrado**, y **no devuelve `0`** | mismo archivo › `rejects.toThrow(...)`, sin ningún aserto que acepte `0` (T2.2) |
| **R5** | con zona → se pide **esa** zona | mismo archivo › caso vigente «se pide con la ZONA del adminSatelite», **sin editar** (T3.1) |
| **R6** | `maestro`/`admin` → global (`null`) | mismo archivo › caso vigente «maestro y admin lo piden GLOBAL», **sin editar** (T3.1) |
| **R7** | `adminTienda` → sigue contando **su** tienda | mismo archivo › caso vigente «se pide con el usuarioId de la tienda», **sin editar** (T3.1) |
| **R8** | el predicado de la 146 no se toca | `git diff --stat` **vacío** de `NotificacionRepository.ts` y `notificacion-visibilidad.test.ts` + esa suite verde sin editarse (T5.1) |
| **R9** | el aviso se muestra **sin número** y el fallo se **registra** | `tests/unit/services/notificacion-service.test.ts` › caso nuevo con el resolutor real + logger espía (T4.1) |
| **R10** | retirar **cualquiera** de las dos protecciones pone algo en **rojo** sin tocar la 146 | **mutaciones M1 y M4** ejecutadas, con su salida en `progress/impl_417_backend.md` (T6.1, T6.4) |

---

## Archivos que toca la implementación (esperado)

| Archivo | Qué |
| --- | --- |
| `lib/services/VigenciaAvisoAgregadoService.ts` | las **dos** guardas (**único archivo de producción con cambio de comportamiento**) |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | documentación del contrato |
| `tests/unit/services/vigencia-aviso-agregado.test.ts` | deroga **un** caso, añade los de R1/R2 y R3/R4 |
| `tests/unit/services/notificacion-service.test.ts` | **añade** un caso (R5) |
| `progress/impl_417_backend.md` | bitácora |
| `specs/417-alcance-aviso-satelite-sin-zona/tasks.md` | casillas |

**Nada más.** Si el diff toca `db/`, `app/`, `components/` o cualquier otro servicio, **para**: eso
ya no es esta ficha.

---

## Antes de empezar

**Cero preguntas abiertas.** La única del borrador se cerró el 2026-09-10: el **caso espejo de
`novedades_sin_gestionar` ENTRA** (R3, R4, R7; T1.2, T2.2, M4/M5). La simetría se verificó en el
código antes de aceptarla y el único matiz —qué pasaría si mañana se ampliara la audiencia de ese
aviso— está escrito en `design.md` §7.

**Si al implementar apareciera una razón real por la que la rama de tienda NO debe comprobar el rol,
para y dilo** en vez de forzarla: sería un dato nuevo, y este spec se corrige, no se cumple a
ciegas.
