# Feature 420 — El gate dice "dependencias presentes" cuando falta una dependencia declarada (tasks)

> Checklist del implementer. `[P]` = paralelizable dentro de su grupo.
> Archivos tocados: `init.sh`, `scripts/verificar-dependencias.mjs` (nuevo),
> `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts` (nuevo),
> `docs/verification.md`, `specs/420-*/`, `progress/impl_420.md`.
> **NO se toca** `feature_list.json` (lo lleva el leader) ni
> `tests/integration/db/*-migration.test.ts` (los lleva la ficha 421, en paralelo).
> Gate: `./init.sh` **completo** — tocar `init.sh` niega el modo rápido por diseño.

---

### Grupo 0 — Medir antes de decidir

- [x] **T0 — Reproducir el defecto y medir la alternativa (design.md).**
  **Hecho cuando:** está escrito en `design.md` (a) el gate dando `✓ dependencias presentes`
  con `web-push` fuera del árbol, (b) el `TS2307` que sale dos pasos después, (c) el tiempo de
  `pnpm install --frozen-lockfile` idempotente en 3 corridas, (d) el resultado con registro
  inalcanzable y (e) si destruye o no el cliente Prisma generado.
  Depende de: nada.

### Grupo 1 — Los tests, en rojo primero

- [x] **T1 — Tests del verificador (R1, R2, R3, R4, R5).**
  `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts`. Monta árboles falsos
  en un directorio temporal (`node:fs.mkdtempSync`) —nunca el árbol real para los casos
  rojos— y ejecuta el script con `node` sobre cada uno:
  - todas presentes → exit 0 y STDOUT con la cifra;
  - una ausente → exit 1 y STDERR **nombrando** el paquete ausente y **no** los presentes;
  - varias ausentes, mezclando `dependencies` y `devDependencies` y un paquete con scope
    (`@tipo/algo`) → exit 1 nombrándolas todas;
  - enlace simbólico **roto** (el caso real de pnpm) → exit 1;
  - `node_modules` ausente por completo → exit 1 con su mensaje propio;
  - el rojo trae el comando de reparación.
  **Hecho cuando:** los casos existen y fallan contra un repo sin el script (no existe) o
  contra una versión que no comprueba nada.
  Depende de: nada.

- [x] **T2 [P] — Test del árbol REAL (R1).**
  En el mismo archivo: correr el verificador contra la raíz del repo y exigir verde. Es el test
  que habría cazado el caso de la 410 al correr la suite.
  Depende de: nada.

- [x] **T3 [P] — Guardia de composición: `init.sh` lo LLAMA (R6).**
  En el mismo archivo: leer `init.sh` y exigir (a) que invoque
  `scripts/verificar-dependencias.mjs`, (b) que esa invocación esté encadenada a `fail`, y
  (c) que **no quede** ningún `ok "dependencias presentes"` colgando solo del `-d node_modules`.
  Un verificador que nadie llama es el mismo fallo mudo, un piso más abajo.
  Depende de: nada.

- [x] **T4 [P] — Guardia de aislamiento del verificador (R7).**
  En el mismo archivo: el fuente del script no importa nada fuera de `node:*` ni usa
  `child_process`/`fetch`.
  Depende de: nada.

### Grupo 2 — La implementación

- [x] **T5 — `scripts/verificar-dependencias.mjs` (R1, R2, R3, R4, R7).**
  **Hecho cuando:** T1, T2 y T4 pasan en verde.
  Depende de: T1.

- [x] **T6 — Paso 2 de `init.sh` (R2, R5, R6).**
  Sustituir el `ok` incondicional por la llamada al verificador con `|| fail`; el `pnpm install`
  de arranque pasa a `--frozen-lockfile` y a fallar explícitamente. Comentario en el archivo con
  el incidente y su fecha, al estilo del resto de `init.sh`.
  **Hecho cuando:** T3 pasa en verde.
  Depende de: T5.

### Grupo 3 — La prueba de que sirve

- [x] **T7 — El rojo, demostrado de punta a punta.**
  Con el arreglo puesto: quitar `node_modules/web-push` del árbol, correr `./init.sh` y enseñar
  que **el paso de dependencias** corta el gate nombrando `web-push`. Contraste contra la misma
  situación sin el arreglo (T0.a). Los dos logs, con `INIT_EXIT=$?` **escrito dentro del log**.
  Depende de: T6.

- [x] **T8 — Mutación de CONTROL, diseñada para morir.**
  Dos mutaciones, cada una revertida por copia byte a byte verificada con SHA256 (**nunca**
  `git checkout --`): (a) en el script, que nunca reporte ausencias; (b) en `init.sh`, quitar la
  llamada. Las dos deben **matar** tests concretos, y se anota cuál.
  Depende de: T6.

- [x] **T9 — `docs/verification.md` y `progress/impl_420.md`.**
  Documentar el paso nuevo y su límite; bitácora con el mapa `R<n> → test`, la salida real del
  gate y el veredicto.
  Depende de: T7, T8.
