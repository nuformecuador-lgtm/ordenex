// Lista, uno por linea y relativos al repo, los archivos de test que FALLARON en un reporte JSON
// de vitest. Lo usa `init.sh --rapido` para repetir AISLADOS solo esos archivos (2026-10-05):
// un rojo que pasa solo es intermitente (deadlock 40P01, conteos de tabla entera con otros tests
// escribiendo) y no debe tumbar el gate ni obligar a correr todo otra vez.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const reporte = process.argv[2];
if (!reporte || !existsSync(reporte)) process.exit(0);
const json = JSON.parse(readFileSync(reporte, "utf8"));
const rojos = (json.testResults ?? [])
  .filter((t) => t.status === "failed")
  .map((t) => path.relative(process.cwd(), t.name).split(path.sep).join("/"));
process.stdout.write(rojos.join("\n"));
