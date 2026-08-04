# Feature 183 — Tasks

> Zona `fullstack`: se secuencia **backend → frontend**. Los bloques A–D los ejecuta
> `backend_dev`; E–F, `frontend_dev`; G–H, quien cierre.
> `[P]` = paralelizable con las tasks marcadas igual dentro del mismo bloque.
>
> **Gate de tanda:** `./init.sh --rapido`. **Gate de PR:** `./init.sh` completo, sin excepción.

---

## Bloque 0 — Puerta (bloquea todo)

- [ ] **T0. Leer la decisión y confirmar el encuadre.**
  Leer `progress/decision_183.md` entero. Confirmar que la `status_note` de la ficha 183 en
  `feature_list.json` («retirar en las CUATRO») **está superada** y no se sigue.
  Confirmar respuestas a **P1–P4** de `requirements.md` (la puerta humana las contesta antes de
  tocar el frontend; P1 y P4 conviene tenerlas antes de T3).
  **Hecho:** las cuatro preguntas tienen respuesta registrada por el leader, o consta por escrito
  que P2/P3 se resuelven con su default antes de empezar el bloque E.

---

## Bloque A — El contrato (backend). Depende de T0

- [ ] **T1. `ImporteAnalitico` pasa a unión discriminada por `forma`.**
  En `lib/types/analitica-financiera.ts`: `ImporteConNeto` (`forma: "bruto_y_neto"`, bruto, neto,
  moneda) + `ImporteSoloBruto` (`forma: "solo_bruto"`, bruto, moneda) + el alias unión. Actualizar
  el bloque de cabecera ⟨D1⟩/R37 (`:15-17`) y el comentario del tipo (`:45-53`) para que declaren
  la acotación y citen ⟨D12⟩ con su fecha.
  **No** se toca `IDS_FINANCIERAS_SERVIDAS`, `IDS_FINANCIERAS_ACUMULADAS` ni `esMetricaAcumulada`.
  **Hecho:** `pnpm run typecheck` enumera los consumidores rotos (se espera **rojo aquí**: es la
  lista de trabajo de T5–T6 y del bloque E) y `lib/types/analitica-financiera.ts` no importa nada
  nuevo. (R1, R2, R14, R15)

- [ ] **T2. Test de forma del contrato.** [P]
  En `tests/unit/analytics/financiera-contratos.test.ts`: dar vuelta el bloque R37
  (`:160-176`) — `ImporteConNeto` sigue exigiendo los dos campos y **`ImporteSoloBruto` no admite
  `neto`**, con `@ts-expect-error`. Añadir el caso de que la unión discrimina (un `switch` sobre
  `forma` sin rama por defecto no compila si falta un miembro).
  **Hecho:** los casos pasan y, al quitar el discriminante del tipo, el `@ts-expect-error` se
  convierte en directiva no usada y `typecheck` cae. (R2, R18)

---

## Bloque B — El catálogo (backend). Depende de T1

- [ ] **T3. `egresos` gana `ingreso_ajuste` y su descripción.**
  En `lib/analytics/metrics.ts`, entrada `egresos` (`:476-510`) y **solo** ahí:
  (a) `definicion.categorias` 8 → 9, añadiendo `ingreso_ajuste` al final sin reordenar las ocho;
  (b) la `descripcion` con el texto de `design.md §4`;
  (c) un comentario que cite `progress/decision_183.md` y escriba **2026-08-04**;
  (d) corregir `metrics.ts:493`, que dice «Σ de las ocho categorías `egreso_*`».
  Las tres entradas de Q1 (`:429-475`) **no se tocan**.
  **Hecho:** `git diff lib/analytics/metrics.ts` se lee entero de un vistazo y es exactamente esas
  cuatro cosas; `pnpm exec vitest run guard` verde salvo los rojos por diseño de T4.
  (R5, R10, R11, R12, R4)

- [ ] **T4. Dar vuelta las cuatro aserciones de «ocho categorías» + el fixture de descripción.**
  - `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts:134-144` → nueve, y sigue **sin**
    `ingreso_reverso_pago_tienda`; `tercerosDeclaradasPor("egresos")` sigue `["egreso_pago_tienda"]`.
  - `tests/unit/analytics/financiera-produccion.guardia.test.ts:84-91` → nueve, conservando el
    lado que protege (recortar la definición encoge la cifra).
  - `tests/unit/services/analitica-financiera-service.test.ts:304-309` → `toHaveLength(9)`.
  - En el mismo archivo de guardia de naturaleza, **ampliar el bloque R53/R54** (`:159-218`) con
    `DESCRIPCION_EGRESOS_PRE_183` como fixture literal y un predicado
    `declaraElDescuentoDe183(descripcion)`; un caso demuestra que el texto **pre-183 no lo pasa**.
  **Hecho:** los cuatro archivos verdes; al revertir a mano la descripción al texto pre-183, el
  caso nuevo se pone rojo (comprobado: aplicado, rojo, revertido). (R5, R11, R25)

- [ ] **T5. Guardia de catálogo↔decisión.** [P con T4]
  Correr `tests/unit/analytics/catalogo-produccion.guardia.test.ts` y verificar que sigue verde
  **por construcción**: el bloque de `egresos` cita ahora tres decisiones (⟨D8⟩, ⟨P4⟩, ⟨D12⟩) y
  cada fecha escrita está respaldada por el documento que el propio bloque cita.
  **Hecho:** verde; y borrando la cita a `progress/decision_183.md` del comentario, se pone rojo.
  (R12)

---

## Bloque C — El servicio (backend). Depende de T1 y T3

- [ ] **T6. `deCaja` recibe la forma; el despacho la elige.**
  En `lib/services/AnaliticaFinancieraService.ts`: partir `importe()` (`:83-89`) en
  `importeConNeto` / `importeSoloBruto` (siguen siendo los únicos que escriben `moneda`);
  `deCaja(consulta, forma)`; el mapa de despacho (`:131-149`) elige por métrica con un selector
  explícito, **sin `if` por id dentro del manejador** (precedente `:139-144`). `derivarBalance`
  solo se llama para `egresos`.
  Actualizar la prosa que queda mintiendo: `:46-53`, `:136-137`, `:199-211`.
  **Hecho:** `pnpm exec vitest related --run lib/services/AnaliticaFinancieraService.ts` verde
  salvo lo que T7 reescribe; ni una resta de dinero escrita en el servicio. (R1, R3, R6, R8)

- [ ] **T7. Reexpresar los dobles imposibles con el par real.**
  - `tests/unit/services/analitica-financiera-derivacion.test.ts:170-187`: el caso «el par se
    cancela en el neto y se ve en el bruto» pasa a `egresos` con `egreso_gasto`/`egreso` +
    `ingreso_ajuste`/`ingreso` → `neto "0.00"`, `bruto "800.00"`.
  - Mismo archivo `:151-168`: el neto negativo se traslada a `egresos` (ya no hay neto en
    `ingreso_flete`), conservando el espía sobre `derivarBalance`.
  - Añadir el caso de las tres de Q1: el DTO **no** trae `neto` (comprobado sobre el objeto
    serializado, no solo por tipos).
  **Hecho:** ninguna fixture de estos archivos contiene una combinación categoría↔tipo que el
  `CHECK` de la 173 rechace; los casos pasan. (R1, R7, R8, R24)

- [ ] **T8. El repositorio: el `WHERE` lleva las nueve.** [P con T7]
  En `tests/unit/analytics/financiera-ingresos-repo.test.ts`: `:108-117` pasa a las nueve **y**
  afirma sobre `fake.llamadas[0].args.where.categoria.in` (el doble de servicio no ve el SQL);
  `:119-131` sustituye la fila cruzada por el par real. `lib/repositories/IngresosAnaliticaRepository.ts`
  **no cambia** salvo la prosa de `:69-82`; `IIngresosAnaliticaRepository.ts:26-40` se actualiza
  (el desglose por tipo sigue existiendo, pero ya no para las cuatro).
  **Hecho:** el test que altera `definicion.categorias` en memoria (`:139-164`) sigue verde — la
  lista sigue viniendo del catálogo. (R5, R17, R24)

- [ ] **T9. La cifra no se mueve: integración contra Postgres.** Depende de T6
  En `tests/integration/actions/analitica-financiera-action.test.ts`:
  (a) **dar vuelta F.4(b)** (`:452-474`): el contraasiento real **entra** → `bruto "800.00"`,
      `neto "0.00"`, con las dos filas comprobadas en el libro;
  (b) reescribir el comentario `:402-427`, que hoy afirma que el neto 0 no es alcanzable;
  (c) **caso nuevo de no-regresión**: sembrar el censo de producción del 2026-08-04 (4 filas
      `egreso_pago_mensajero` = 22000.00 y 1 `egreso_indemnizacion` = 42.40, **cero**
      `ingreso_ajuste`) en transacción revertida y ventana de 2031, y afirmar
      `bruto "22042.40"` / `neto "-22042.40"`.
  **Hecho:** los tres casos verdes contra Postgres; quitando `ingreso_ajuste` del catálogo, (a) se
  pone rojo y (c) sigue verde — que es la demostración de que el cambio no mueve la cifra vieja.
  (R7, R9, R25)

- [ ] **T10. Guardia de forma por vista.** [P con T9]
  Caso nuevo (junto a los guardias financieros) que recorre las **diez** métricas servidas con el
  doble, y afirma: las tres de Q1 → `solo_bruto`; las otras siete → `bruto_y_neto`; y que en cada
  vista **el total y todas sus filas comparten forma**.
  **Hecho:** verde; cambiando la forma de una sola métrica en el despacho, rojo. (R14, R18)

---

## Bloque D — Cierre de backend

- [ ] **T11. Gate de backend.** Depende de T2–T10
  `./init.sh --rapido` verde. Barrido de prosa: ninguna cabecera de `lib/**` sigue afirmando «las
  ocho categorías `egreso_*`» ni «los dos importes de las cuatro métricas de caja».
  **Hecho:** verde y el barrido en cero.

---

## Bloque E — Frontend. Depende de T11 y de las respuestas a P1–P3

- [ ] **T12. `adaptar.ts`.**
  `filasDeVista` escribe la clave `neto` **solo** si la vista es `bruto_y_neto` (nunca `null`,
  nunca `0`, nunca derivado del bruto); nace `COLUMNAS_IMPORTE_SOLO_BRUTO` y
  `columnasDeVista(vista)`; `serieDeVista` se estrecha por forma. Sigue sin sumar, restar ni
  derivar nada (R14 de la 132).
  **Hecho:** `pnpm exec vitest related --run app/(app)/analitica/_components/financiero/adaptar.ts`
  verde; el módulo sigue siendo puro (sin React, sin I/O). (R19, R21, R22, R23)

- [ ] **T13. `TableroFinanciero.tsx`.** Depende de T12
  `TotalDelDto` y `PanelKpi` ramifican por `total.forma`: con neto, exactamente como hoy; sin
  neto, KPI = bruto con la etiqueta de P2 y **sin** línea secundaria ni marcador de ausente.
  `ContenidoDeVista` emite **una** serie donde no hay neto y dos donde sí. Ningún id de métrica
  escrito en el componente.
  **Hecho:** `tests/unit/guards/tablero-financiero.guardia.test.ts` verde (no detecta ids
  financieros ni props-función nuevas). (R19, R20, R21, R22)

- [ ] **T14. Tests de tablero y adaptador.** Depende de T13
  - `tests/components/TableroFinanciero.test.tsx:443-454`: R16/132 se reexpresa sobre una métrica
    **con** neto; caso nuevo para R19 sobre una **sin** neto que comprueba que **no** aparece la
    etiqueta «Neto» ni el marcador de dato ausente en esa sección.
  - Caso de R21: la gráfica de una vista sin neto recibe **una** serie.
  - Fixtures de `tablero-financiero-adaptar.test.ts`, `tablero-financiero-cargar.test.ts`,
    `AnaliticaPage.test.tsx` y `tests/unit/services/_dobles-analitica-financiera.ts` ganan el
    discriminante mediante **un** helper compartido.
  **Hecho:** verdes; y con la mutación «pintar `null` donde iba el neto», el caso de R19 se pone
  rojo. (R19, R20, R21, R23)

---

## Bloque F — Rastro y cierre. Depende de T14

- [ ] **T15. Notas de corrección en los specs ajenos (si P4 = sí).** [P]
  Nota fechada (2026-08-04) al margen de **R18 y R37** en
  `specs/127-analitica-financiera-servicios/requirements.md` y de **R14 y R16** en
  `specs/132-analitica-tablero-financiero/requirements.md`, citando ⟨D12⟩ y esta feature. **No se
  reescribe el texto original.** Precedente: `specs/160-badge-intentos-entrega/tasks.md:300-302`.
  **Hecho:** las cuatro notas existen y dicen exactamente qué queda acotado y qué sigue intacto.
  (R26)

- [ ] **T16. `progress/impl_183.md` con el mapa R→test.** [P con T15]
  Una fila por cada `R1`–`R27`, con archivo **y nombre del caso**, construida **leyendo el caso**.
  Prohibido contar `R\d+` en títulos (cruza espacios de nombres; falso 68/68 documentado).
  Registrar además la salida real de los tests y las mutaciones aplicadas-rojas-revertidas.
  **Hecho:** 27 de 27 filas, cada archivo citado existe, y ninguna fila cita un caso que no
  verifica su requisito. (R27)

- [ ] **T17. Gate completo y PR.** Depende de T15, T16
  `./init.sh` completo verde. El cuerpo del PR lleva **§2 y §4 de `progress/decision_183.md`**
  (qué autoriza y qué no) y el resumen del inventario de rojos dados vuelta.
  **Hecho:** PR abierto con esos párrafos a la vista; `spec_path`, `branch` y `status` de la ficha
  183 actualizados por el leader.

- [ ] **T18. Medición post-merge de la cifra.** Depende de T17
  Por MCP contra **producción**, de solo lectura: agregado de `wallet_movimiento` por categoría y
  tipo, y confirmar que `egresos` sigue valiendo ₡22.042,40 de bruto (o explicar la diferencia con
  las filas que la produjeron). Dejar constancia en `progress/impl_183.md`.
  **Límite declarado, no asumido:** el MCP está fijado al proyecto de producción; **preview no es
  verificable por esta vía**.
  **Hecho:** la medición está escrita con fecha y cifras, no «debería seguir igual». (R9)

---

## Grafo de dependencias

```
T0 ─┬─ T1 ─┬─ T2 [P]
    │      ├─ T3 ─┬─ T4 [P]
    │      │      └─ T5 [P]
    │      └─ T6 ─┬─ T7 ─┐
    │             ├─ T8 [P]
    │             ├─ T9 ─┤
    │             └─ T10 [P]
    └──────────────────── T11 ── T12 ── T13 ── T14 ─┬─ T15 [P] ─┬─ T17 ── T18
                                                    └─ T16 [P] ─┘
```
