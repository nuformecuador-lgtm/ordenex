# Review — Feature 117: filtro de órdenes por cantón y distrito (mensajero)

> Reviewer del arné SDD. Rama `feature/117-filtro-canton-distrito` (0 detrás / 4 adelante
> de `origin/dev`; `dev` ya integrado, sin merge necesario). No se editó código.

## Veredicto: APROBADO

No hay hallazgos bloqueantes. `./init.sh` en verde (`== init OK ==`), suite completa
482 archivos / 4804 tests / 4804 passed; suite acotada de la 117 = 87 passed.

## Checklist del arné

- [x] **Especificación completa.** `requirements.md` (R1–R14 EARS), `design.md` (con
  alternativas descartadas A/B/C y su porqué), `tasks.md` con T0–T7 todas `[x]`.
- [x] **Trazabilidad R→test.** Cada R1–R14 mapea a ≥1 test real con aserciones (tabla abajo).
- [x] **Lógica pura.** `lib/utils/filtro-canton-distrito.ts`: `derivarCantones`
  (label "Cantón (Provincia)", dedup por cantón+provincia normalizado, orden es),
  `derivarDistritos` (solo del cantón elegido, encadenado, sin nulos),
  `filtrarAsignaciones({canton,distrito})`; reusa `normalizeName`. Sin React/DOM/red.
  Unit propio: `tests/unit/filtro-canton-distrito.test.ts` (R2/R4/R6/R7/R13).
- [x] **Sin backend.** No hay migración, endpoint ni Server Action nueva. Filtrado 100%
  cliente sobre `MiAsignacionDTO` ya cargado por props. `page.tsx`, service, repos y el
  contrato del DTO no se tocan (confirmado en el diff).
- [x] **Selects encadenados.** Distrito `disabled` sin cantón (R3); cambiar cantón resetea
  distrito vía `setCantonYReset` (R5); centinela `__todos__ → ""` y "Limpiar filtros"
  (R8/R9). Opciones de cantón derivadas de la UNIÓN completa sin filtrar (R13).
- [x] **Decisión del gate (R14/R10).** `paradasMapa`, `porGestionarVisual` (grilla) y
  `detalleOrden` derivan todos de `porGestionarFiltrado` (conjunto filtrado). Salvaguarda:
  si `ordenEnGestionId` cae fuera del filtro se reinserta preservando el orden de ruta;
  con `ordenEnGestionId === null` no aplica a nadie. Verificado en test R10 (lista + mapa).
- [x] **Composición con el buscador (114).** AND sobre las mismas listas visibles:
  `porRecogerFiltrado = aplicarFiltroZona(filtrarAsignaciones(porRecoger, query))`;
  en reparto, buscador (con la orden en gestión siempre incluida) y luego filtro zona.
  Con `canton === ""` la lógica devuelve la MISMA referencia ⇒ comportamiento de 114
  idéntico. No se duplica el pipeline: 117 se monta encima del de 114.
- [x] **Preservación 113/114/115/116.** Filtro solo en la vista de lista, no en modo foco
  (test "en modo foco NO se renderiza"). 113 (detalle inline/foco), 114 (buscador),
  115 (badge/toggle/sort sobre el conjunto filtrado) y 116 (nota privada + indicador)
  intactos; toda la suite del módulo verde.
- [x] **Verificación ejecutable.** `./init.sh` → `== init OK ==` (typecheck sin errores
  tras regenerar el cliente Prisma —falso negativo local documentado—; lint 0 errores,
  143 warnings pre-existentes ajenos a la 117; test 4804/4804). Corrido por el reviewer.
- [x] **Calidad + checklist.** Sin `console.log` ni `any` en los archivos de la 117.
  Textos de UI en español claro y separados en constantes (i18n-ready). Tasks `[x]`.

## Tabla R → test (verificada, archivo:línea)

| Req | Test que lo verifica |
| --- | --- |
| R1  | `tests/components/MisAsignacionesModule.test.tsx:1604` (renderiza selects) + `:1618` (no en modo foco) |
| R2  | `tests/unit/filtro-canton-distrito.test.ts:39,53,65` (etiqueta/orden, dedup, homónimos) + comp `:1632` |
| R3  | comp `:1671` (distrito deshabilitado sin cantón) |
| R4  | `tests/unit/filtro-canton-distrito.test.ts:79,95` + comp `:1681` (solo distritos del cantón) |
| R5  | comp `:1717` (cambiar cantón resetea distrito) |
| R6  | `tests/unit/filtro-canton-distrito.test.ts:119,124,132,140` (incl. excluye distrito nulo) + comp `:1766` |
| R7  | `tests/unit/filtro-canton-distrito.test.ts:114` (misma referencia sin cantón) |
| R8  | comp `:1812` (Limpiar filtros) + `:1854` (opción "Todos los cantones") |
| R9  | comp `:1889` (Limpiar aparece/desaparece según filtro activo) |
| R10 | comp `:1919` (orden en gestión visible en lista y mapa pese al filtro; control g3 sí se filtra) |
| R11 | comp `:1975` (mensaje "coincide con el filtro", distinto del vacío base y del buscador) |
| R12 | unit (funciones puras, sin red/Server Actions) + comp `:2066` (AND con buscador, sin fetch) |
| R13 | `tests/unit/filtro-canton-distrito.test.ts:149` (opciones del conjunto completo, no del filtrado) |
| R14 | comp `:2022` (panel de detalle y mapa reflejan el conjunto filtrado) |

## Hallazgos

### Bloqueantes
- Ninguno.

### Menores (no bloquean; informativos)
- **M1 — Homónimos de cantón con `value` colisionante (R2).** `derivarCantones` produce dos
  opciones con etiquetas distintas ("Central (San José)" / "Central (Alajuela)") pero el
  mismo `value` "Central"; elegir cualquiera filtra por nombre de cantón y mostraría AMBAS
  provincias. Es una limitación **documentada y aceptada** en el gate F1.4 (`design.md §3`):
  un mensajero opera en una sola zona, colisión prácticamente nula en su carga. Aceptable
  para el caso de uso; se deja anotado por si a futuro un mensajero multi-zona lo expone.
- **M2 — Doble etiquetado del combobox.** Cada `Select` tiene `<label htmlFor>` visible
  ("Cantón"/"Distrito") y además `aria-label` ("Filtrar por cantón/distrito"); el nombre
  accesible lo gana el `aria-label` (por eso los tests resuelven por ese nombre). Redundancia
  inocua, no afecta funcionalidad ni accesibilidad. Sin acción requerida.

## Notas de entorno
- El worktree venía sin `node_modules`; se instaló y se regeneró el cliente Prisma con un
  `DATABASE_URL` dummy (`prisma generate` no conecta). El fallo inicial de typecheck por
  "@prisma/client sin exports" era el falso negativo local ya documentado, no un defecto
  de la feature. Tras regenerar, `./init.sh` quedó en verde.
- Warnings pre-existentes ajenos a la 117: `migraciones sin down.sql` (chat/whatsapp) y
  "no hay .env"; ninguno bloquea el arné.
