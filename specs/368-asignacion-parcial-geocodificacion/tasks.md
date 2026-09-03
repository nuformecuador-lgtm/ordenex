# Feature 368 — tasks

> **Regla de «hecho» en esta ficha:** el criterio es un aserto que se pone rojo si el código está
> mal, nunca un `grep` ni «se leyó y está bien».
>
> **Restricciones duras heredadas del encargo** (no tocar, aunque el diseño roce la zona):
> `app/(app)/ordenes/_components/OrdenesListado.tsx`, `app/(app)/ordenes/_components/ordenes-columns.tsx`,
> `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` (ficha 367, otra sesión en
> curso) y todo lo de `ZonaRepository`/zonas-distritos (ficha 366). Ninguna task de aquí necesita
> tocarlos: el detalle de bloqueadas se renderiza dentro de los dos modales de asignación, no en el
> listado.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T1 [P] — Los cuatro tipos: `"partial"` en las dos interfaces de dominio y sus dos espejos de acción

- `lib/interfaces/services/IGuiaAsignacionService.ts`: `AsignarBodegaServiceResult` gana
  `{ status: "partial"; resultados: AsignarBodegaResultadoItem[]; bloqueadas: DetalleConflicto[] }`.
- `lib/interfaces/services/IAsignacionSateliteService.ts`: `AsignarSateliteServiceResult` gana el
  espejo con `{ ordenId: string; estado: "por_recoger" }[]` / `{ ordenId; motivo }[]`.
- `lib/types/orden-guia.ts`: `AsignarBodegaResult` gana la misma variante (los server actions hacen
  passthrough directo, así que este tipo tiene que llevar exactamente la misma unión).
- `lib/types/recepcion-satelite.ts`: `AsignarSateliteResult`, ídem.

**Hecho cuando:** `pnpm tsc --noEmit` (o el paso equivalente de `init.sh`) compila sin error nuevo
con los cuatro tipos ampliados, y ningún `switch`/objeto de mapeo exhaustivo sobre estos tipos en el
árbol (`guia-decision-error-messages.ts`, `asignacion-satelite-error-messages.ts`, los dos modales)
queda con un caso `"partial"` sin manejar — si TypeScript no lo marca por no ser `switch`
exhaustivo con `never`, se verifica a mano y se anota en `progress/impl_368.md` cuáles NO necesitan
tocar `"partial"` y por qué (los dos mappers de error: `"partial"` nunca llega a ellos porque el
modal no lo lanza, ver T3/T4).

**No hacer:** tocar `DetalleConflicto` (no gana ningún campo — ver `design.md` §2.2).

---

## T2 [P] — `mensajeDireccionPorMotivo` en `geocodificacion-motivo-messages.ts` · R11

Función exportada nueva, junto a `geocodificacionMotivoMessage`, que reusa el `MOTIVO_A_MENSAJE` ya
existente en el módulo (no duplica el vocabulario). Firma: `(motivo: string) => string | null`.

**Hecho cuando:** existe (o se amplía)
`tests/unit/components/geocodificacion-motivo-messages.test.ts` con:

1. los cinco motivos de `EstadoAsignabilidad` no-`asignable`, cada uno mapeado al mensaje que le
   toca (`direccion_no_geocodificable`/`geocodificacion_agotada` → `MSG_DIRECCION_NO_ENCONTRADA`;
   los otros tres → `MSG_DIRECCION_EN_VALIDACION`);
2. un motivo no reconocido (ej. `"zona_ajena"`, `"estado_invalido: x"`) → `null`;
3. un caso que afirme que `geocodificacionMotivoMessage` (la función agregada existente) sigue
   comportándose igual — no-regresión, porque ambas funciones comparten el mapa.

---

## T3 — Lógica de `GuiaAsignacionService.asignarDesdeBodega` · R1, R3, R4, R6, R18 (depende de T1)

Cambiar el tramo final descrito en `design.md` §3.1: filtrar `asignables` a partir de
`detalleCoords`, escribir solo `asignables` con `asignarBodegaLote`, devolver `"ok"` / `"partial"` /
`"conflict"` según corresponda. Reescribir el docstring de `gateCoordenadas` y el comentario del
gate en `asignarDesdeBodega` (`design.md` §8, R19) para nombrar la ficha 368 y la regla vigente.

**Hecho cuando:** en `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`:

1. el caso existente `it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN persistir", ...)` del bloque
   `describe("R8 — asignarDesdeBodega...")` (lote de 2 órdenes, solo `o1` bloqueada) se ACTUALIZA:
   pasa a afirmar `status === "partial"`, `resultados: [{ ordenId: "o2", estado: "por_recoger" }]`,
   `bloqueadas: [{ ordenId: "o1", motivo: estado }]`, y que `asignarBodegaLote` **se llamó** con
   `["o2"]` — no con `["o1", "o2"]`;
2. caso nuevo: **las dos** órdenes del lote bloqueadas por coordenadas (distintos motivos) →
   `status === "conflict"`, `detalle` con las dos entradas, `asignarBodegaLote` **no** se llama (R3,
   no-regresión del caso ya cubierto en el archivo satélite gemelo);
3. caso nuevo: lote de 3, una bloqueada al medio (`o1`, `o2` bloqueada, `o3`) → `resultados` trae
   `o1` y `o3` **en ese orden**, `bloqueadas` trae `o2`; afirma que el orden de `ordenIds` original
   se preserva en ambos arrays (protege contra un `filter`/`Set` que reordene);
4. no-regresión: el caso `"todas asignables -> persiste con normalidad"` sigue verde tal cual
   (`status === "ok"`, sin `bloqueadas`);
5. no-regresión: el caso del tope de intentos (feature 276) y el resto de guardas anteriores al gate
   siguen sin invocar `g.evaluar` cuando rechazan antes (ver `guia-asignacion-tope-intentos.test.ts`,
   no se toca).

---

## T4 — Lógica de `AsignacionSateliteService.asignar` · R2, R3, R4, R6, R17, R18 (depende de T1)

Mismo cambio que T3 en el bloque `4b`, más el ajuste del chequeo de carrera del paso 7 (compara
contra `asignables.length`, combina `detalleCarrera` + `detalleCoords` cuando dispara — `design.md`
§5). Reescribir los comentarios del bloque `4b` y del paso 7.

**Hecho cuando:** en `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts`:

1. el caso `it.each(NO_ASIGNABLES)("motivo %s -> conflict SIN escribir", ...)` (lote `o1`/`o2`, solo
   `o1` bloqueada) se ACTUALIZA a `status === "partial"`, con `asignarSateliteLote` llamado con
   `["o2"]`;
2. no-regresión: el caso `"TODO-O-NADA: dos ordenes no asignables..."` sigue verde tal cual
   (`conflict`, cero escrituras) — es exactamente R3;
3. caso nuevo, el de carrera compuesta (R17): 3 órdenes, `o1` bloqueada por coordenadas,
   `asignarSateliteLote` (doble) devuelve un `count` menor que `asignables.length` simulando que
   `o2` perdió la carrera; afirma `status === "conflict"` y que `detalle` contiene tanto el motivo
   de `o1` (coordenadas) como el de `o2` (carrera) — nunca `"partial"` ni `"ok"` en este camino;
4. no-regresión: el caso `"el gate corre DESPUES de las guardas de zona/estado..."` sigue verde tal
   cual.

---

## T5 [P] — `AsignarBodegaModal.tsx`: rama `"partial"` · R10, R12, R13, R14 (depende de T2, T3)

Implementar el cambio de `handleConfirm` de `design.md` §6.2: `"partial"` deja de lanzarse, se
resuelve el `numRemision` de cada bloqueada desde el `ordenes` prop ya recibido (nunca desde el
backend), se compone el toast y se guarda `bloqueadas` en el estado `resultado`. El JSX de la fase
"resultado" gana el bloque `role="alert"` con la lista de bloqueadas cuando `bloqueadas.length > 0`.

**Hecho cuando:** en `tests/components/AsignarBodegaModal.test.tsx`:

1. con el mock de `asignarDesdeBodega` devolviendo `partial` (2 asignadas, 1 bloqueada con motivo
   `"direccion_no_geocodificable"`), tras confirmar: el toast de éxito se llama con un texto que
   incluye "2" y "1" (o el conteo equivalente — el aserto no depende del literal exacto de Q1, solo
   de los números); el DOM de la fase "resultado" muestra el `numRemision` de la orden bloqueada
   (tomado del `ordenes` prop del test, NO de un campo inventado en la respuesta) y el texto
   "Dirección no encontrada";
2. `errorMock` (el canal de error del `Modal`) **no** se llama en el caso `partial` — es un
   resultado que sí tuvo efecto, no un error;
3. `onSuccess` sigue difiriéndose al cierre del panel de resultado (patrón feature 148, no cambia);
4. no-regresión: el caso existente de `status: "ok"` puro sigue verde sin ninguna mención a
   bloqueadas en el DOM;
5. no-regresión: un `status: "conflict"` (p. ej. mensajero bloqueado por cierres) sigue lanzando al
   canal de error y mostrando el toast de `errorMock` con `guiaDecisionErrorMessage`, sin tocar la
   fase "resultado".

---

## T6 — `AsignarSateliteModal.tsx`: rama `"partial"` · R10, R12, R13, R14 (depende de T2, T4)

Mismo tratamiento que T5, espejo exacto (R5: mismo criterio, mismo vocabulario).

**Hecho cuando:** `tests/components/AsignarSateliteModal.test.tsx` con los 5 casos de T5, adaptados
a `asignarDesdeSatelite` / `RecepcionSateliteDTO`.

---

## T7 [P] — Integración: las dos server actions pasan `"partial"` sin traducirlo · R15, R16

**Hecho cuando:**

- `tests/integration/actions/ordenes-guia-action.test.ts`: un caso que, con un service de prueba
  que devuelve `{ status: "partial", ... }`, afirma que `asignarDesdeBodega` (la action) devuelve
  exactamente ese objeto sin envolverlo ni alterarlo (passthrough, `design.md` §2.1);
- `tests/integration/actions/asignacion-satelite-action.test.ts`, mismo caso para
  `asignarDesdeSatelite`.

---

## T8 [P] — Guardia de vocabulario compartido · R5, R11

**Hecho cuando:** `tests/unit/guards/...` (nuevo archivo o ampliación de uno existente del mismo
directorio) afirma que `AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx` importan
`mensajeDireccionPorMotivo` del MISMO módulo (`geocodificacion-motivo-messages.ts`) — nunca un
literal propio copiado en cada archivo. Falla si alguno de los dos define su propio mapa de
motivo→mensaje.

---

## T9 — Bookkeeping (depende de T1–T8)

- `progress/impl_368-asignacion-parcial-geocodificacion.md` con el mapa **R → test** completo
  (R1–R19 de `requirements.md`), y la decisión tomada sobre Q1 (con quién la confirmó y cuándo).
- `feature_list.json`: ficha **368** actualizada (estado, `spec_path`). El diff debe tocar
  **solo** esa ficha.
- `progress/current.md` al día.
- ⚠️ Comprobar el **blob commiteado**, no el árbol de trabajo:
  `git show HEAD:specs/368-asignacion-parcial-geocodificacion/tasks.md | head`.

**Hecho cuando:** el reviewer encuentra los 19 requisitos con un test nombrado y ejecutable.

---

## T10 — Gate (depende de T1–T9)

`./init.sh --rapido` (el diff de esta ficha no toca migraciones, `db/schema.prisma`, `lib/types/`
de dominio compartido más allá de los dos archivos de tipos de acción/servicio ya existentes, ni
archivos con nombre de dinero — no debería auto-negarse al modo rápido; si el arnés lo niega,
confirmar por qué antes de forzar el completo). Recordatorio de `CLAUDE.md`: el gate completo corre
igual, en segundo plano, tras el merge a `dev`.

**Hecho cuando:** `./init.sh --rapido` termina en verde, con `INIT_EXIT` escrito dentro del log.

---

## Trazabilidad · R → test

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | central: parcial con mezcla | `guia-asignacion-gate-coordenadas` (T3.1, T3.3) |
| R2 | satélite: mismo comportamiento | `asignacion-satelite-gate-coordenadas` (T4.1) |
| R3 | ninguna asignable → fallo total, sin cambios | `guia-asignacion-gate-coordenadas` (T3.2) · `asignacion-satelite-gate-coordenadas` (T4.2) |
| R4 | todas asignables → éxito total, sin cambios | `guia-asignacion-gate-coordenadas` (T3.4) · `asignacion-satelite-gate-coordenadas` (no-regresión T4) |
| R5 | mismo criterio y vocabulario en las dos bodegas | T8 · `AsignarSateliteModal.test.tsx` (T6, espejo de T5) |
| R6 | parcial SOLO por motivo de coordenadas | T3, T4 (el filtro solo consulta `detalleCoords`) |
| R7 | motivos de estado/pertenencia siguen todo-o-nada | no-regresión T3.5, tests de guardas ya existentes no tocados |
| R8 | motivos de mensajero/lote siguen todo-o-nada y antes del gate | no-regresión T3.5 · `asignacion-satelite-tope-intentos.test.ts` (no tocado) |
| R9 | `generarGuia`/`rutearABodegaSatelite`/recolección sin cambios | no se tocan sus archivos ni sus tests (verificable por `git diff`) |
| R10 | identificador visible por orden bloqueada | `AsignarBodegaModal.test.tsx` (T5.1) · `AsignarSateliteModal.test.tsx` (T6) |
| R11 | motivo en vocabulario ya existente, por orden | T2 · T5.1 · T6 |
| R12 | conteo asignadas/bloqueadas | T5.1 · T6 |
| R13 | manifiesto de las asignadas sigue disponible | T5 (no-regresión, `ManifiestoResultado` no cambia) |
| R14 | sin PII nueva | T2.1-2 (mensajes fijos) · T5.1 (no se afirma dirección ni id en el DOM) |
| R15 | tres desenlaces, parcial lleva ambos conjuntos | T1 · T3 · T4 |
| R16 | `conflict` conserva su forma | T1 (compilación) · T7 |
| R17 | carrera de satélite: fallo total, con ambos motivos | T4.3 |
| R18 | supersede solo el motivo de coordenadas | `design.md` §7-8, comentarios reescritos en T3/T4 |
| R19 | comentarios "todo-o-nada" reescritos | revisión de diff en T3/T4 (criterio humano del reviewer) |

---

## Orden y paralelismo

```
T1 [P] ─┬─> T3 ──> T5 [P] ────────┐
        ├─> T4 ──> T6 [P] ────────┤
T2 [P] ─┴───────────────────────  ┼──> T9 ──> T10
T7 [P] ────────────────────────── ┤
T8 [P] ─(depende de T5, T6)────── ┘
```

Notas:

- **T3 y T4 son independientes entre sí** (servicios distintos, sin dependencia de código
  compartido más allá de los tipos de T1) — pero conviene hacerlas en la misma sesión porque
  comparten el mismo patrón y el mismo riesgo de divergencia (R5).
- **T8 va después de T5 y T6**, no antes: necesita que los dos modales ya importen
  `mensajeDireccionPorMotivo` para poder afirmar que lo hacen del mismo módulo.
- **T9 (bookkeeping) antes del gate final** para que `progress/impl_368...md` documente qué pasó con
  Q1 antes de pedir la aprobación de cierre.
