# Feature 148 — Manifiesto Excel al crear o mover órdenes · REVIEW

Revisor: agente `reviewer`. Fecha: 2026-07-28.
Worktree: `../ordenex-wt-148`, rama `feature/148-manifiesto-excel-lotes`, 16 commits sobre
`origin/dev` @ `55b0cd4`. Diff revisado: `git diff origin/dev...HEAD` (44 archivos, +4196 / -48).

## VEREDICTO: RECHAZADO — 2 bloqueantes, 8 menores

El trabajo técnico es sólido: la trazabilidad R1–R30 es real (verificada abriendo los tests,
no leyendo las bitácoras), las líneas rojas del gate se respetan, la prueba por mutación mata
tests en las 6 invariantes probadas y los números declarados cuadran exactamente con los que
medí. Los 2 bloqueantes son de cierre, no de diseño, y ambos se arreglan sin tocar la lógica.

---

## 1. Verificación ejecutable (medida por MÍ, no por las bitácoras)

| | Baseline declarado (55b0cd4) | Final declarado | Medido por el reviewer | Delta |
|---|---|---|---|---|
| pnpm typecheck | 0 errores | 0 errores | **0 errores** | 0 |
| pnpm lint | — | 0 errores / 145 warnings | **0 errores / 145 warnings** | 0 |
| pnpm test --run | 518 archivos / 5308 tests | 524 / 5400, 0 fallos | **524 archivos / 5400 tests** | **+6 archivos / +92 tests** |
| ./init.sh | — | verde | **verde (exit 0)**, con la suite 524/5400 y **0 fallos** | — |

+92 = +57 (backend: 32+11+14) +35 (frontend: 7+8+9+11). Cuadra al test.
**Delta de regresiones = 0.** Ningún test ajeno cambió de estado.

Nota sobre una corrida: en mi PRIMERA ejecución de `pnpm test --run` cayó 1 test,
`tests/integration/recuperar-contrasena-form.test.tsx` (findByText con timeout bajo carga).
Reejecutado en aislamiento: 7/7 verde. Y la corrida completa de `./init.sh` dio
**524/524 archivos, 5400/5400 tests, 0 fallos**. Es flake ajena a la 148 (menor 7).

---

## 2. Prueba por MUTACIÓN

Se rompió a propósito una invariante y se comprobó qué tests mueren. Los archivos mutados se
restauraron desde copia de respaldo; `git status --porcelain` quedó vacío al terminar.

| # | Mutación introducida | Resultado | Tests que murieron |
|---|---|---|---|
| A | Invertir origen/destino de `carga_masiva` (fila 1 de la tabla del §4): tienda→central pasa a central→tienda | **KILL (2)** | "carga_masiva: TIENDA -> CENTRAL, responsable el actor"; "sin zona central configurada, origen/destino caen al literal de respaldo" |
| B | `responsable` usa SIEMPRE el actor aunque haya mensajero asignado (2 ramas) | **KILL (3)** | "generacion_guia, orden GAM CON mensajero..."; "asignacion_satelite: ZONA -> ZONA, responsable el mensajero"; "responsable es el mensajero asignado..." |
| C | `esVisiblePara` devuelve true siempre: se quita el acotamiento por tienda del actor apiKey (R29) | **KILL (2)** | "con actor apiKey solo incluye ordenes de su tienda"; "una API key de otra tienda no obtiene NINGUNA fila del lote" |
| D | Alterar el orden de las 11 columnas (origen/destino permutadas en COLUMNAS_MANIFIESTO) | **KILL (2)** | "R2: la cabecera trae las 11 columnas pedidas, en el orden pedido"; "R4/R6/R7: vuelca los valores de la fila en su columna" |
| E | El diferimiento pierde el refresco: `handleOpenChange` de GenerarGuiaModal deja de llamar `onSuccess()` | **KILL (5)** | "R25: un fallo de la descarga NO re-ejecuta..."; 2 de GenerarGuiaModal.test.tsx; **2 de OrdenesListadoEtiquetasChain.test.tsx (feature 95)** |
| F | El fallo de la descarga se traga en silencio (se quita el toast.error del catch) | **KILL (2)** | "R26: si la generación del binario lanza, se informa..."; "R25: un fallo de la descarga NO re-ejecuta..." |

**Ninguna mutación quedó viva: no hay tests decorativos en las invariantes probadas.**
La mutación E es la más informativa: demuestra que los 3 tests ajustados de la feature 95
siguen siendo aserciones VIVAS y que la garantía de refresco del padre está genuinamente
cubierta, no relajada.

---

## 3. Trazabilidad R1–R30 → test (verificada abriendo cada test, no la bitácora)

| R | Test que lo ejercita de verdad |
|---|---|
| R1 | manifiesto-service › "arma las filas de los 6 flujos con el mismo servicio" (itera MANIFIESTO_FLUJOS y asserta 11 claves) + "la carga masiva usa el MISMO servicio por num_remision" |
| R2 | manifiesto-service › "no expone ids internos..." (Object.keys EN ORDEN); manifiesto-xlsx › "la cabecera trae las 11 columnas... en el orden pedido" (+ columnCount === 11). Matado por mutación D |
| R3 | manifiesto-service › "devuelve N filas... en el orden en que se pidieron" (el repo devuelve en otro orden a propósito) + "un id repetido no duplica la fila"; manifiesto-xlsx › "emite una fila de datos por orden" |
| R4 | orden-repository.manifiesto › "proyecta guia, remision, destinatario, telefono y direccion"; manifiesto-service › idem a nivel de fila |
| R5 | manifiesto-service › "deja num_guia vacio..."; manifiesto-xlsx › "sin guía y sin monto las celdas quedan VACÍAS" (lee la celda del binario recargado) |
| R6 | manifiesto-service › "usa el nombre de la zona, no su id" (+ afirma que ningún id de zona se filtra) |
| R7 | 3 casos: null → vacío, 0 → 0 (no vacío), 25.5 → propaga; repo › Decimal → number |
| R8 | **8 casos, uno por fila de la tabla del §4** + el respaldo "Bodega central". Matados por mutación A |
| R9 | "responsable es el mensajero..." / "...es el usuario que ejecutó" + repo › findUsuarioNombre. Matados por mutación B |
| R10 | Reloj fijo 2026-07-16T02:00Z → 2026-07-15; asserta explícitamente que NO es toISOString().slice(0,10) (off-by-one) |
| R11 | service › Object.keys exacto + JSON.stringify sin id de orden/tienda/deleted; repo › el select NO pide deletedAt/notas/producto/geografía; xlsx › un campo ajeno no llega al archivo |
| R12 | service › omite y reporta sin abortar (x2); repo › deletedAt null en ambos where; botón › avisa cuántas quedaron fuera y descarga igual |
| R13 | manifiesto-xlsx › round-trip REAL con ExcelJS.Workbook.load, 1 sola hoja, valores leídos por celda |
| R14 | manifiesto-xlsx › manifiesto-flujo-fecha.xlsx (x2); botón › lee el anchor.download real del DOM |
| R15 | DescargarManifiestoButton › Blob con MIME XLSX + anchor.click + revokeObjectURL, y **expect(fetch).not.toHaveBeenCalled()** |
| R16 | botón › promesa suspendida, toBeDisabled, 2º clic ignorado, obtenerManifiesto llamado 1 vez |
| R17 | botón › selección vacía no renderiza (ids y remisiones) + 0 filas no genera archivo; buildManifiestoXlsx([]) lanza; ManifiestoFlujos › nuevasCount 0 y la sección "En tránsito" sin envío previo |
| R18–R23 | ManifiestoFlujos, un test por flujo, cada uno asserta el {flujo, seleccion} exacto que viaja a la action. **R22 comprueba que la orden que falló (d2) NO entra: ordenIds ["d1"]** |
| R24 | service › **Proxy** que registra CUALQUIER acceso fuera de los 3 métodos de lectura, en los 6 flujos + la vía por remisiones; action › Object.keys(service) === ["armar"] |
| R25 | ManifiestoFlujos › la action del manifiesto rechaza y se comprueba generarGuia 1 vez, success 1 vez, el resumen sigue en pantalla y onSuccess ocurre al cerrar. Matado por mutaciones E y F |
| R26 | botón › mensaje accionable por causa (/vuelve a iniciar sesión/, /vuelve a intentarlo/) y rehabilitación. Matado por mutación F |
| R27 | Por diff (los 5 services no aparecen) + ManifiestoFlujos › input y toast idénticos + los tests propios de los 5 modales, verdes con sus mismas aserciones |
| R28 | manifiesto-action › unauthenticated sin tocar el service, **y antes de validar la entrada** (el resultado no contiene la remisión enviada) |
| R29 | 5 tests de service (apiKey propia/ajena, rol de sesión sí ve, vía remisión acotada a actor.usuarioId) + repo › tiendaId en el where. Matados por mutación C |
| R30 | manifiesto-action › **9 casos** parametrizados (vacíos, string vacío, flujo inventado, flujo ausente, sin selección, no-array, remisiones en flujo no-masivo, input no-objeto), todos sin tocar el service |

**30/30 requisitos con al menos un test que realmente los ejercita. Sin huecos.**

---

## 4. Líneas rojas del gate

- **R27 / D-gate-1 — los 5 servicios de negocio INTACTOS.** Verificado contra el diff, no
  contra las bitácoras: `git diff --stat origin/dev...HEAD` NO lista BulkOrdenService.ts,
  GuiaAsignacionService.ts, AsignacionSateliteService.ts, EnvioDevolucionCentralService.ts
  ni DevolucionOrigenService.ts. Tampoco sus interfaces ni la ruta del chunk de carga
  masiva. El lote de los flujos 4 y 5 se acumula en la UI (enviadasIds /
  ultimoEnvioACentral), como cerró el §9.1. **CUMPLE.**
- **R25 — un fallo de la descarga no re-ejecuta, no revierte y no cambia el resultado.**
  Probado de verdad (mutaciones E y F, más el test que hace rechazar obtenerManifiesto).
  Además es cierto POR CONSTRUCCIÓN: el botón no tiene ninguna referencia a la acción de
  negocio y su catch solo dispara un toast; handleOpenChange (donde vive onSuccess) no se
  atraviesa desde el catch. **CUMPLE.**
- **D3 — cero migraciones, cero db/schema.prisma, cero RLS nueva.** El diff no toca db/**.
  ./init.sh confirma "todas las migraciones tienen down.sql". **CUMPLE.**
- **D1 — generación en CLIENTE, exceljs con import dinámico DENTRO de la función, sin
  Storage ni endpoint de archivos.** buildXlsxRows hace
  `const ExcelJS = (await import("exceljs")).default` dentro del cuerpo
  (lib/utils/xlsx-template.ts:184); el botón además importa manifiesto-xlsx de forma
  dinámica. El binario se envuelve en Blob + anchor en components/shared/descargar-blob.ts
  y el test afirma que fetch no se llama. No hay ruta de API ni bucket. **CUMPLE.**

---

## 5. Los 3 cambios NO previstos en design.md

1. **findUsuarioNombre en IOrdenRepository — JUSTIFICADO.** R9/§9.8 exige el NOMBRE del
   ejecutor y Actor solo lleva { usuarioId, rol }. Resolverlo en el borde metería Prisma
   dentro de la Server Action (violaría el patrón de capas). Precedente exacto en la MISMA
   interfaz: findUsuarioFulfillment, findUsuarioZonaId, findUsuarioVehiculoId. Es
   estrictamente aditivo (ninguna firma existente cambió) y está cubierto por 2 tests de
   repo. NO es alcance de más. Coste real: +3 stubs en 5 suites ajenas (ver §6).
2. **components/shared/ManifiestoResultado.tsx — JUSTIFICADO.** 4 consumidores (la regla de
   docs/architecture.md para shared/ pide 2 o más), y NO duplica ni el mapeo de columnas
   (vive en el servicio único, R1) ni la mecánica de descarga (sigue en UN solo botón, con
   lo que la alternativa E descartada en el §7 se respeta). Es composición, no lógica.
   NO es alcance de más.
3. **onSuccess() diferido al cierre de la fase "resultado" — JUSTIFICADO Y FORZOSO, pero con
   un efecto colateral no cerrado (bloqueante 2).** El onSuccess de los padres cierra el
   modal y refresca; invocarlo al confirmar destruiría la fase donde vive el botón que el
   humano aprobó en el §9.7. La implementación envuelve onOpenChange para cubrir el cierre
   por CUALQUIER vía (botón, Escape, overlay), así que ninguna de las garantías de refresco
   se pierde:
   - Refresco de listados / router.refresh(): intacto, solo posterior. La mutación E lo prueba.
   - Invalidación de SWR: OrdenesCargaResumen (SWR) no vive en un modal; no le afecta.
   - Contadores / navegación: RecepcionSateliteModule no es modal; su refresco (enviadas,
     limpieza de la selección, toasts) ocurre exactamente cuando ocurría.
   - Encadenado a "Imprimir etiquetas" (feature 95): sigue ocurriendo, ahora tras el cierre.

   Los 3 tests ajustados NO se relajaron: conservan íntegras todas sus aserciones
   (generarGuiaMock 1 vez, el diálogo de etiquetas con el MISMO lote, "cerrar el modal de
   etiquetas termina el flujo") y solo añaden un click en "Cerrar". La mutación E mata 2 de
   ellos, así que siguen siendo aserciones vivas.

   PERO el efecto colateral se cerró solo para los tests de vitest y se dejó fuera el único
   E2E que confirma uno de esos modales. Ver BLOQUEANTE 2.

---

## 6. Los 12 tests ajenos tocados, uno por uno

**Backend (5 suites, +4 líneas cada una)** — asignacion-mensajero-service,
bulk-orden-service, bulk-orden-service.carga-api, orden-service, rol-admin-satelite-authz:
las cinco declaran el repo como objeto literal EXHAUSTIVO de IOrdenRepository, así que
cualquier método nuevo en la interfaz las rompe en typecheck. Se añadieron 3 stubs
vi.fn() en cada una. **Ninguna aserción tocada, ningún expect eliminado ni aflojado.**
Adaptación mecánica legítima.

**Frontend (7 suites):**
- GenerarGuiaModal (2 tests), AsignarBodegaModal, AsignarSateliteModal, RutearSateliteModal,
  DevolverATiendaModal (1 cada uno): se añade un click en "Cerrar" ANTES del waitFor de
  onSuccess ya existente. Las aserciones previas (toHaveBeenCalledWith del input de negocio,
  el texto exacto del toast, onSuccess EXACTAMENTE 1 vez) quedan idénticas.
  Adaptación, no aflojamiento.
- OrdenesListadoEtiquetasChain (3 tests, feature 95): igual, un click en "Cerrar" dentro del
  diálogo correcto (within(guiaDialog) / within(asignarDialog)) antes de esperar el diálogo
  de etiquetas. Se conservan generarGuiaMock 1 vez, la comprobación de que el lote encadenado
  es el mismo y que cerrar etiquetas termina el flujo. **La mutación E las mata, luego no son
  decorativas.**
- BulkUpload (T21): el doble de @/lib/utils/xlsx-template reexpone XLSX_MIME con EL MISMO
  valor literal que tenía la constante local borrada; los tests de MIME y de nombre de
  archivo siguen intactos. Cambio obligado por el import dinámico. Legítimo.

**Ningún test ajeno perdió una aserción.** Revisado línea a línea sobre el diff.

---

## 7. Checklist de CHECKPOINTS.md

| Ítem | Estado |
|---|---|
| requirements.md con EARS numerados | OK (R1–R30) |
| design.md con alternativa descartada y su porqué | OK (§7: 5 alternativas A–E con su razón) |
| tasks.md con TODAS las tasks [x] | **FALLA — BLOQUEANTE 1** (las 22 siguen en [ ]) |
| Cada R mapea a 1 o más tests concretos | OK 30/30, verificado abriendo los tests |
| progress/impl_<feature>.md con el mapa R → test | PARCIAL — menor 1 (partido en 2 archivos) |
| pnpm run typecheck sin errores | OK, 0 |
| pnpm run lint sin errores | OK, 0 errores / 145 warnings (igual que el baseline) |
| pnpm test pasa | OK, 524/5400, 0 fallos en la corrida de ./init.sh |
| E2E si toca flujo crítico | **FALLA — BLOQUEANTE 2** (el E2E del flujo tocado quedó desalineado) |
| RLS en tabla nueva | n/a (D3: sin tabla) |
| Migraciones reversibles | n/a (cero migraciones); ./init.sh valida los down.sql |
| Sin secretos hardcodeados | OK |
| Webhooks con firma / idempotencia | n/a |
| Controller sin queries ni lógica | OK: lib/actions/manifiesto.ts es zod + actor + delegación |
| Service sin HTTP | OK: ManifiestoService recibe repos por constructor; no importa next/headers ni Prisma |
| Repository solo queries | OK: WITH_MANIFIESTO + serializador, sin lógica de negocio |
| Interfaces en lib/interfaces/ por categoría | OK: services/IManifiestoService.ts, repositories/IOrdenRepository.ts |
| Páginas protegidas validan en servidor | OK (sin rutas nuevas; la action exige sesión, R28) |
| private/ recibe datos por props | OK |
| Mutaciones por Server Actions, no fetch | OK (es un READ, y va por Server Action) |
| Sin hardcode de país, moneda ni cuenta | OK (el literal "Bodega central" es el respaldo aprobado en el §9.2, no un dato de contexto) |
| ./init.sh en verde | OK, exit 0 |
| progress/review_<feature>.md con veredicto OK | **FALLA** — este archivo: RECHAZADO |
| Entrada en progress/history.md | FALTA — menor 2 (cierre del leader) |

---

## 8. Hallazgos

### BLOQUEANTE 1 — tasks.md: las 22 tareas siguen sin marcar

specs/148-manifiesto-excel-lotes/tasks.md tiene **T1–T22 en [ ]**, ninguna en [x], pese a
que todas están ejecutadas (verificado contra el diff y contra los commits).
CHECKPOINTS.md > Especificacion lo exige literalmente: "todas las tasks estan marcadas [x]".
Fue el mismo bloqueante de la feature 140.

**Qué falta para cumplirlo:** marcar [x] las 22 tareas. Si alguna se considera no completada,
decirlo explícitamente en la bitácora en vez de dejarla ambigua.

### BLOQUEANTE 2 — el E2E asignacion-satelite.spec.ts no se adaptó a la fase "resultado"

El diferimiento de onSuccess() cambia el comportamiento observable de los 4 modales, y hay un
E2E que confirma uno de ellos y NO se tocó: e2e/asignacion-satelite.spec.ts:94-105, test
"seleccionar orden recibida -> Asignar mensajero -> por_recoger".

Dos roturas concretas, ambas causadas por esta feature:

1. **Línea 97 — violación del strict mode de Playwright.**
   `await expect(page.getByText(/Mensajero asignado a/i)).toBeVisible();`
   Tras el cambio ese texto aparece DOS veces: en el toast (toast.success(mensaje)) y en el
   Alert role="status" de ManifiestoResultado, que recibe EL MISMO string. En
   AsignarSateliteModal.tsx: `const mensaje = ...; toast.success(mensaje);
   setResultado({ ordenIds, mensaje })`. page.getByText en modo estricto falla con
   "resolved to 2 elements".

2. **Líneas 99-105 — la aserción ya no mide lo que dice.**
   `await expect(recibidas.getByRole("checkbox", { name: ... })).toHaveCount(0);`
   con el comentario "After router.refresh(), the order left Recibidas". Ese router.refresh()
   va dentro de onSuccess y YA NO ha ocurrido en ese punto: ahora se dispara al cerrar la
   fase "resultado". El diálogo abierto marca el fondo con aria-hidden, así que el
   toHaveCount(0) puede pasar POR EL MOTIVO EQUIVOCADO (elemento fuera del árbol de
   accesibilidad, no porque la orden haya transicionado). El test dejaría de verificar la
   transición en_bodega_satelite -> por_recoger, que es justo lo que dice cubrir.

Como los E2E de Playwright no corren en `pnpm test` ni en `./init.sh`, esto NO aparece en
rojo en ninguna corrida: por eso hay que arreglarlo antes del merge, no después.

**Qué falta para cumplirlo:** añadir el click en "Cerrar" tras confirmar (igual que se hizo
en los 7 tests de vitest) y reafirmar la salida de "Recibidas" DESPUÉS de ese cierre;
desambiguar la aserción del toast (acotarla al contenedor del toast, o usar .first() con la
razón escrita). Y dejar constancia en la bitácora del frontend de que el efecto colateral del
diferimiento alcanza también a la capa E2E, no solo a los 12 tests de vitest declarados.

### Menores

1. **menor — el mapa R → test está partido en dos archivos.** T22 pedía
   progress/impl_148-manifiesto-excel-lotes.md con el mapa R1..R30; existen
   impl_148_backend.md (R1–R12, R24, R27–R30) e impl_148_frontend.md (R2–R3, R5, R7,
   R11–R23, R25–R27). Entre los dos está completo y ambos son honestos sobre su mitad, pero
   no hay un único mapa consolidado como exige CHECKPOINTS.md > Trazabilidad.
2. **menor — falta la entrada en progress/history.md.** Es tarea de cierre del leader, pero
   está en la checklist.
3. **menor — design.md §4 afirma que num_remision es único POR TIENDA**; en db/schema.prisma
   es @unique GLOBAL. Ya lo declaró el backend_dev (su deuda 3). No cambia el código (acotar
   por tiendaId sigue siendo lo correcto por R29), pero el design queda con una afirmación
   inexacta.
4. **menor — asignacion_satelite añade un respaldo que la tabla del §4 no contempla.**
   ubicacionesDe devuelve `responsable: mensajero ?? ctx.actor`, mientras la tabla dice
   MENSAJERO seco. Es defensivo y razonable (una asignación siempre deja mensajero), pero
   NINGÚN test fija ese respaldo: si la rama `?? ctx.actor` desapareciera, la suite seguiría
   verde. Cubrirlo o eliminarlo.
5. **menor — responsable vacío ("") si findUsuarioNombre devuelve null**
   (ManifiestoService.armar:153). Documentado como deuda por el backend_dev, sin test que lo
   fije. Emitir "" es coherente con el §9.8 (que prohíbe textos de rol), pero conviene
   decidirlo explícitamente.
6. **menor — manifiestoSchema es un z.union de objetos no estrictos.** Una entrada
   { flujo: "carga_masiva", ordenIds: [...], numRemisiones: [...] } casa con la PRIMERA rama
   y numRemisiones se ignora en silencio. No es alcanzable desde la UI (el botón manda una
   sola forma de selección), pero el borde no es tan cerrado como sugiere R30.
7. **menor — flake ajena.** tests/integration/recuperar-contrasena-form.test.tsx falló una vez
   bajo carga (findByText con timeout) en mi primera corrida completa, y pasó aislada (7/7) y
   dentro de ./init.sh (524/524 archivos). No es de la 148 ni de su diff; queda anotada porque
   puede reaparecer en CI.
8. **menor — el botón del último envío a central persiste.** En RecepcionSateliteModule el
   botón "Descargar manifiesto del último envío" queda visible indefinidamente tras el envío
   (hasta recargar la página), sin distinguir "recién enviado" de "hace media hora". Ya
   declarado como limitación (bitácora frontend, deuda 3); es una decisión de UX que conviene
   que el humano vea en vivo.

---

## 9. Qué NO es hallazgo (revisado y correcto)

- El orden de hooks en DescargarManifiestoButton (el `return null` de R17 va DESPUÉS del
  useState): correcto, no rompe las reglas de hooks.
- `montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null`: un Decimal(0) es un
  objeto y por tanto truthy, así que el 0 NO se convierte en null. Además hay un test
  explícito ("un monto de cero se emite como 0, no como celda vacia").
- El `deps` como segundo parámetro de la Server Action: precedente exacto en
  lib/actions/etiquetas-guia.ts:60.
- DevolverATiendaModal lanza al primer error y por tanto no llega a la fase "resultado" en
  fallo parcial: es el comportamiento PREVIO, no lo introduce esta feature, y hay un test que
  lo fija ("si el envío a la tienda falla, no hay fase de resultado ni manifiesto").
- El conflicto previsto con la feature 143 (design.md §5) no se materializó: buildXlsxRows y
  XLSX_MIME no existían en esta base. Sigue siendo un riesgo de merge si la 143 aterriza
  después; la nota del design cubre cómo resolverlo.

---

## 10. Resumen para el leader

**RECHAZADO por 2 bloqueantes, ambos de cierre y baratos:**

1. Marcar las 22 tareas de specs/148-manifiesto-excel-lotes/tasks.md como [x].
2. Adaptar e2e/asignacion-satelite.spec.ts a la fase "resultado" (click en "Cerrar" antes de
   comprobar la salida de "Recibidas", y desambiguar la aserción del texto "Mensajero
   asignado a", que ahora aparece dos veces), y registrar en la bitácora del frontend que el
   efecto colateral del diferimiento alcanza también a la capa E2E.

Vuelve al frontend_dev. **No hay nada que rehacer en la lógica:** los 30 requisitos están
trazados a tests vivos, las 4 líneas rojas del gate se cumplen, las 6 mutaciones murieron,
los 12 tests ajenos son adaptaciones legítimas y el delta de regresiones es 0.

---
---

# RE-REVIEW (segunda vuelta) — 2026-07-28

Base: los **4 commits nuevos** sobre lo revisado (`6efa4e7..HEAD`): `be05b1f` (casillas +
informe), `95147f3` (E2E), `57149f0` (respaldo de `responsable`), `02eb87d` (bitácora).
Diff auditado: 8 archivos, +550 / -27.

## VEREDICTO: APROBADO-CON-NOTAS — 0 bloqueantes vivos

Los 2 bloqueantes están **realmente cerrados** y la corrección **no introdujo nada nuevo en
rojo**: ningún test ajeno se aflojó, el delta de la suite es exactamente +2 tests, y de las 4
mutaciones nuevas 3 matan tests y la 4ª sobrevive **confirmando un menor ya abierto**, no uno
nuevo.

## 1. Números medidos por MÍ

| | Declarado | Medido por el reviewer | Veredicto |
|---|---|---|---|
| pnpm typecheck | 0 | **0 errores** (exit 0) | coincide |
| pnpm lint | 0 errores / 145 warnings | **0 errores / 145 warnings** | coincide |
| pnpm test --run | 524 archivos / 5402 tests, 0 fallos | **524 archivos / 5402 tests, 0 fallos** (exit 0) | coincide |
| ./init.sh | exit 0 | verde en la 1ª vuelta; en esta corrí la suite completa aparte, exit 0 | coincide |

Delta contra mi propia medición de la primera vuelta (524 / **5400**): **+2 tests, 0
regresiones, 0 archivos nuevos**. Cuadra exactamente con los 2 tests añadidos al respaldo de
`responsable`. **Cero fallos en esta corrida** (ni siquiera la flake que vi la vez pasada).

## 2. BLOQ-1 — casillas de tasks.md: CERRADO

- grep: **0 casillas en `[ ]`, 22 en `[x]`** (T1–T22, ninguna omitida).
- El diff de tasks.md es **exclusivamente el volteo de casillas**: comprobado con
  `git diff | grep "^+" | grep -vc "^+- \[x\]"` → **0**. No se editó ni un texto de tarea, ni
  un "Hecho cuando", ni un mapeo de R. No hay riesgo de que se haya "ajustado" el criterio
  para poder marcar.
- ¿Marcadas sin estar hechas? Contrastadas contra el diff de la rama: T1–T6 (tipos,
  interfaces, repo, service, action), T7–T9 (xlsx, módulo puro, botón + helper), T10–T14 (los
  6 puntos de UI), T15–T21 (los 6 archivos de test + los ajustes) y T22 (verificación
  ejecutable) tienen todas su artefacto real en el árbol. **Ninguna casilla es falsa.**
- Única salvedad, ya registrada como menor 1: el "Hecho cuando" de T22 pide el mapa R1..R30 en
  UN archivo `progress/impl_148-manifiesto-excel-lotes.md`, y sigue partido en
  impl_148_backend.md + impl_148_frontend.md. Es desviación de forma, no de fondo (los 30 R
  están mapeados); queda como deuda, no reabre el bloqueante.

## 3. BLOQ-2 — los 3 E2E: CERRADO, y el hallazgo del agente es correcto

Mi review original identificó **1** spec afectado; el frontend_dev auditó los 18 y encontró
**3**. Verificado: tenía razón, mi auditoría se quedó corta.

### 3.1 asignacion-satelite.spec.ts — las dos roturas que reporté, resueltas bien

- **Strict mode.** El acotamiento es a `getByRole("region", { name: "Notificaciones" })`, que
  resuelve al Toast.Viewport real: `providers/ToastProvider.tsx:102-104` lo declara
  literalmente `role="region"` + `aria-label="Notificaciones"`. **Comprobé que NO puede
  apuntar al elemento equivocado**: el otro candidato con ese nombre accesible es
  `NotificationsBell.tsx:142`, que es un **button**, no una region, así que
  `getByRole("region", ...)` lo excluye por rol; y el resumen del modal (Alert role="status"
  dentro del dialog) también queda fuera de la región. **La aserción sigue midiendo el toast
  de éxito, y solo el toast.** Se evitó `.first()`, que es justo lo que habría podido pasar
  mirando el nodo equivocado. Correcto.
- **La aserción del listado.** Ahora el orden es: comprobar la fase "resultado" (resumen +
  botón de manifiesto) → pulsar "Cerrar" → `expect(modal).toBeHidden()` → **recién entonces**
  el `toHaveCount(0)` sobre "Recibidas".
  ¿Falla ahora si router.refresh() no ocurre? **Sí**, y lo verifiqué leyendo el orden de
  `handleOpenChange`: `setResultado(null); onOpenChange(false); onSuccess();`. El cierre del
  diálogo (y por tanto el `toBeHidden()`) sucede ANTES de `onSuccess`, así que el
  `toBeHidden()` pasaría igual sin refresco: **toda la capacidad de discriminación queda en el
  `toHaveCount(0)` posterior**, que es exactamente donde debe estar. Sin refresco, la orden
  seguiría en "Recibidas" con el diálogo ya cerrado (sin el aria-hidden del fondo que antes la
  tapaba) y la aserción fallaría. **Ya no puede pasar por el motivo equivocado.**
- **No se debilitó nada:** la única línea borrada es la aserción ambigua del toast, sustituida
  por su versión acotada MÁS 5 aserciones nuevas (modal visible, resumen repetido, botón de
  manifiesto, cierre, toBeHidden). El test verifica lo mismo de antes y algo más.

### 3.2 y 3.3 reintentos-escalado.spec.ts y devolucion-origen.spec.ts — rotura latente real

Confirmada contra origin/dev: ambos hacían `await expect(modal).toBeHidden();`
**inmediatamente tras confirmar**, lo que con la fase "resultado" es falso. Los parches son
**puramente aditivos** (+8/-0 y +7/-0, cero líneas borradas): comprueban el botón de
manifiesto, pulsan "Cerrar" y solo entonces esperan toBeHidden(). **Ninguna aserción
preexistente se tocó ni se relajó.**

### 3.4 Verificación estática de TODOS los localizadores nuevos

No pude ejecutarlos (ver §5), así que los contrasté uno a uno contra los componentes:

| Localizador nuevo | Existe en | OK |
|---|---|---|
| region "Notificaciones" | providers/ToastProvider.tsx:102-104 (Toast.Viewport) | si |
| dialog "Asignar mensajero" | título de AsignarSateliteModal y de AsignarBodegaModal | si |
| button "Cerrar" | Modal con `cancelLabel={resultado ? "Cerrar" : "Cancelar"}`; **es el ÚNICO "Cerrar"** del diálogo (Modal.tsx no renderiza botón X) ⇒ sin ambigüedad | si |
| button /Descargar manifiesto/i | DEFAULT_LABEL de DescargarManifiestoButton | si |
| botón de manifiesto en DevolverATiendaModal | se renderiza porque enviadasIds no está vacío cuando todas salieron ok | si |

## 4. Mutaciones NUEVAS (4)

Archivos restaurados desde copia de respaldo; `git status --porcelain` **vacío** al terminar.

| # | Mutación | Resultado | Detalle |
|---|---|---|---|
| **G** | RESPONSABLE_FALLBACK "—" → "" | **KILL (1)** | "sin nombre resoluble del ejecutor, responsable cae al guion largo y no a cadena vacia" |
| **H** | El respaldo del actor pisa al mensajero (`mensajero ?? ctx.actor` → `ctx.actor`) + guion CORTO "-" en vez del largo | **KILL (4)** | incluye "con mensajero asignado, el respaldo del actor no contamina responsable" y el del literal U+2014 ⇒ el guion largo está fijado, no basta un guion cualquiera |
| **I** | Cambiar SOLO la rama de respaldo de asignacion_satelite: `mensajero ?? ctx.actor` → `mensajero ?? RESPONSABLE_FALLBACK` | **SOBREVIVE (34/34 verde)** | confirma que el **menor 4 sigue abierto** (esa rama defensiva no está cubierta). No es hallazgo nuevo ni bloqueante: es la deuda que ya había registrado |
| **J** | Restaurar el helper VIEJO del test (`opts.nombre ?? ACTOR_NOMBRE`) | **KILL (1)** | prueba EMPÍRICA de la afirmación del agente |

**El fallback "—" está realmente cubierto** (G y H lo matan, y H fija el codepoint concreto,
no un guion genérico).

### La afirmación sobre el helper es EXACTA — verificada, no aceptada

El agente afirma que `opts.nombre ?? ACTOR_NOMBRE` colapsaba un `nombre: null` explícito, de
modo que mi menor 5 apuntaba a un caso **inexpresable**. Lo comprobé de dos formas:

1. **Por diff**: la línea previa era literalmente `fakeOrdenRepo(rows, opts.nombre ?? ACTOR_NOMBRE)`.
2. **Por ejecución (mutación J)**: al devolver el helper a su forma vieja, el test nuevo
   **falla** (responsable sale "Ana Maestra" en vez de "—"). Es decir: antes del arreglo el
   caso no podía escribirse desde el helper.

El arreglo (`opts.nombre === undefined ? ACTOR_NOMBRE : opts.nombre`) **no quedó a medias**:
distingue undefined de null y el resto de la suite sigue verde (34/34). **Menor 5: CERRADO.**

## 5. Las dos afirmaciones del agente que se me pidió validar

### 5.1 "Los E2E NO se ejecutaron" — exacta en la conclusión, con UN dato erróneo

- `playwright.config.ts` levanta `webServer: { command: "pnpm dev", url: "http://localhost:3000" }`. **Confirmado.**
- Los specs exigen BD sembrada con usuarios por rol y las credenciales son **placeholders**:
  admin-satelite@example.com, maestro@example.com, mensajero@example.com,
  admin.tienda@example.com, todos con "correct-password". **Confirmado.**
- El encabezado de los 3 specs dice "these tests are WRITTEN but NOT EXECUTED". **Confirmado**
  (líneas 30-31, 71-72 y 50-51 respectivamente).
- `pnpm typecheck` SÍ cubre `e2e/**`: tsconfig.json incluye `**/*.ts` y excluye solo
  node_modules. **Confirmado** ⇒ "lo único verificado es que compilan" es exacto.
- **DATO ERRÓNEO (menor 9):** la bitácora dice "no hay navegadores de Playwright instalados
  (`~/.cache/ms-playwright` no existe)". Esa es la ruta de Linux/macOS. En Windows viven en
  `%LOCALAPPDATA%\ms-playwright`, y **SÍ están instalados**: chromium-1228,
  chromium_headless_shell-1228, ffmpeg-1011, winldd-1007. La **conclusión no cambia** (siguen
  sin poder ejecutarse por falta de BD sembrada y de usuarios reales), pero el motivo
  declarado es parcialmente incorrecto y conviene no propagarlo.

**Yo tampoco los ejecuté, y lo digo así:** habría requerido levantar `pnpm dev` desde este
worktree contra el puerto 3000 —que pueden estar usando las sesiones paralelas— y sembrar la
BD con esos usuarios. No lo hice, por la regla de no salirme del worktree ni perturbar otras
sesiones. **Por eso la petición "mutá el código y confirmá que el E2E lo detectaría" NO es
ejecutable aquí**; la sustituí por (a) la verificación estática de cada localizador contra los
componentes (§3.4) y (b) el análisis del orden `onOpenChange(false)` → `onSuccess()` que
demuestra dónde queda la capacidad de discriminación (§3.1). El equivalente en vitest SÍ está
probado por mutación: la mutación E de la primera vuelta (quitar onSuccess() del cierre) mata
5 tests, 2 de ellos de la cadena de la feature 95.

### 5.2 Drift ajeno preexistente — CONFIRMADO

Verificado con `git show origin/dev:<archivo>`, es decir, **antes de esta feature**:

- reintentos-escalado.spec.ts:203 (en origin/dev): `modal.getByRole("button", { name: "Asignar mensajero" })`.
  El confirmar de AsignarBodegaModal es **"Asignar"**; "Asignar mensajero" es el TÍTULO del
  diálogo y la etiqueta del botón del listado (OrdenesListado.tsx:293). El localizador no
  resuelve **ya en dev**.
- devolucion-origen.spec.ts:114-121 (en origin/dev): usa "Devolver a la tienda" para la región,
  el botón y el diálogo. La feature 139 retiró esa salida manual de `rechazada`
  (OrdenesListado.tsx:77 lo documenta) y la acción vigente es **"Enviar a la tienda"**
  (OrdenesListado.tsx:314), desde otro estado.

**Es preexistente y ajeno a la 148.** Queda como **deuda registrada**, no como bloqueante.
Consecuencia honesta que conviene anotar: como ese drift está en un paso ANTERIOR al que la
148 añadió, las líneas nuevas de esos 2 specs son correctas pero **inalcanzables** hasta que
se sanee el drift; su valor hoy es documental (y compilan).

### 5.3 Flake no-embalaje.test.ts — mismo patrón que mi menor 7: CONFIRMADO

`tests/unit/guards/no-embalaje.test.ts` recorre el árbol del repo con `fs` **síncrono**
(REPO_ROOT + walk). Es exactamente la clase de suite dependiente de I/O y de tiempo que falla
bajo carga alta y pasa aislada: la corrí sola → **1/1 verde**, y mis corridas completas de esta
vuelta dieron **5402/5402 sin un solo fallo**. Encaja con mi menor 7
(recuperar-contrasena-form.test.tsx). **Ajena a la 148**: el guard ignora `progress/` y
`.claude/`, así que ni siquiera este informe lo puede alterar. Se fusiona en el menor 7.

## 6. ¿Se aflojó algo? NO

- **Tests de vitest tocados en estos 4 commits: exactamente 1**, y es el propio de la feature
  (tests/unit/services/manifiesto-service.test.ts, +41/-2). Las 2 líneas borradas son el helper
  colapsante; todo lo demás son aserciones nuevas. **Cero tests ajenos tocados.**
- **E2E**: -1 línea en total en los 3 specs (la aserción ambigua del toast, sustituida por su
  versión acotada) y +40 de aserciones nuevas. Ninguna comprobación se eliminó ni se volvió más
  permisiva.
- **Código de producción**: el único cambio es ManifiestoService ("" → RESPONSABLE_FALLBACK y la
  constante exportada). No toca las 4 líneas rojas del gate: los 5 servicios de negocio siguen
  ausentes del diff, sin migraciones, sin RLS, y la generación sigue en cliente.

## 7. Estado final de los hallazgos

| Hallazgo (1ª vuelta) | Estado |
|---|---|
| **BLOQUEANTE 1** — casillas de tasks.md | **CERRADO** (22/22, diff solo de casillas) |
| **BLOQUEANTE 2** — E2E sin adaptar | **CERRADO y ampliado** (3 specs, no 1; parches aditivos y correctos) |
| menor 1 — mapa R→test partido en 2 archivos | abierto (cierre del leader) |
| menor 2 — falta entrada en progress/history.md | abierto (cierre del leader) |
| menor 3 — design.md §4 dice num_remision único por tienda, es global | abierto (documental) |
| menor 4 — la rama `?? ctx.actor` de asignacion_satelite sin cubrir | **abierto — reconfirmado por la mutación I (sobrevive)** |
| menor 5 — responsable vacío sin test | **CERRADO** (respaldo "—" + 2 tests + helper arreglado; verificado por G/H/J) |
| menor 6 — manifiestoSchema, unión de objetos no estrictos | abierto |
| menor 7 — flake ajena bajo carga | abierto; **absorbe** la de no-embalaje.test.ts |
| menor 8 — el botón del último envío a central persiste | abierto (decisión de UX para el humano) |
| **menor 9 (NUEVO)** — la bitácora afirma que no hay navegadores de Playwright; sí los hay en %LOCALAPPDATA%\ms-playwright | nuevo, documental |

**Deuda registrada al cerrar:** (1) los 3 E2E adaptados nunca se ejecutaron —su verde real
depende de un entorno con BD sembrada—; (2) el drift ajeno de la feature 139 en
reintentos-escalado.spec.ts y devolucion-origen.spec.ts, que además vuelve inalcanzables las
líneas nuevas de esos 2 specs; (3) los menores 1, 2, 3, 4, 6, 8 y 9.

## 8. Resumen

**APROBADO-CON-NOTAS. 0 bloqueantes vivos.** Los dos bloqueantes están cerrados de verdad y
verificados por medios propios (grep + diff para el 1; lectura del Toast.Viewport, del orden de
handleOpenChange y de origin/dev para el 2). Las 4 mutaciones nuevas confirman que el respaldo
"—" está cubierto y que la corrección del helper era real y necesaria. No hay regresiones:
524 / 5402 / 0 fallos, typecheck 0, lint sin errores. La única corrección de fondo que le hago
a la bitácora es el menor 9. Nada de lo que queda abierto impide el merge; todo es deuda
registrada.
