import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Мост между репозиторием и mermaid.live.
 *
 * Зачем. Диаграммы пользовательских путей должны жить в git (их правит и код,
 * и человек), но редактировать mermaid удобнее в живом редакторе с превью.
 * mermaid.live не хранит состояние на сервере — оно целиком закодировано в
 * URL, поэтому ссылка сама по себе и есть носитель диаграммы. Значит обмен
 * возможен без копипаста руками:
 *
 *   npm run diagram:link docs/diagrams/campaign.md
 *     файл → ссылка. Открываешь, правишь, копируешь URL из адресной строки.
 *
 *   npm run diagram:pull docs/diagrams/campaign.md "<url>"
 *     ссылка → файл. Обновляет mermaid-блок, остальной текст не трогает.
 *
 * Формат ссылки проверен на живом mermaid.live (2026-07-31): состояние — JSON
 * { code, mermaid, ... }, сжатый deflate и закодированный base64url после
 * префикса "pako:". Редактор дописывает в него свои поля (тема, зум, счётчик
 * рендеров) — при разборе нас интересует только code, остальное игнорируем.
 */

const FENCE = /```mermaid\r?\n([\s\S]*?)```/;

function readDiagram(file: string): string {
  const raw = fs.readFileSync(file, "utf8");
  if (path.extname(file) === ".mmd") return raw.trim();
  const m = FENCE.exec(raw);
  if (!m) {
    throw new Error(`В файле ${file} нет блока \`\`\`mermaid — нечего открывать.`);
  }
  return m[1].trim();
}

function writeDiagram(file: string, code: string) {
  if (path.extname(file) === ".mmd") {
    fs.writeFileSync(file, `${code}\n`);
    return;
  }
  const raw = fs.readFileSync(file, "utf8");
  if (!FENCE.test(raw)) {
    throw new Error(`В файле ${file} нет блока \`\`\`mermaid — некуда записывать.`);
  }
  // Заменяем только содержимое блока: пояснительный текст вокруг диаграммы
  // (зачем она, что считать изменением) писался руками и переживает обновление.
  // Замена функцией, а не строкой: иначе $& и подобные последовательности в
  // коде диаграммы были бы истолкованы как ссылки на группы совпадения.
  fs.writeFileSync(file, raw.replace(FENCE, () => `\`\`\`mermaid\n${code}\n\`\`\``));
}

function encode(code: string): string {
  const state = {
    code,
    mermaid: JSON.stringify({ theme: "default" }, null, 2),
    autoSync: true,
    updateDiagram: true,
  };
  const deflated = zlib.deflateSync(Buffer.from(JSON.stringify(state), "utf8"), { level: 9 });
  const b64url = deflated.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  return `https://mermaid.live/edit#pako:${b64url}`;
}

function decode(url: string): string {
  const marker = "pako:";
  const at = url.indexOf(marker);
  if (at === -1) {
    throw new Error("В ссылке нет фрагмента #pako: — это не ссылка на диаграмму mermaid.live.");
  }
  // всё после pako: до конца строки; хвостовые пробелы/переводы строк режем
  const payload = url.slice(at + marker.length).trim();
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  let json: string;
  try {
    json = zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8");
  } catch {
    throw new Error("Не удалось разжать ссылку — возможно, она обрезана при копировании.");
  }
  const state = JSON.parse(json) as { code?: unknown };
  if (typeof state.code !== "string" || !state.code.trim()) {
    throw new Error("В ссылке нет кода диаграммы.");
  }
  return state.code.trim();
}

function main() {
  const [command, file, url] = process.argv.slice(2);

  if (command === "link" && file) {
    console.log(encode(readDiagram(file)));
    return;
  }

  if (command === "pull" && file && url) {
    const incoming = decode(url);
    const current = readDiagram(file);
    if (incoming === current) {
      console.log("Диаграмма не изменилась — файл не трогаю.");
      return;
    }
    writeDiagram(file, incoming);
    const before = current.split("\n").length;
    const after = incoming.split("\n").length;
    console.log(`Обновлено: ${file} (строк было ${before}, стало ${after}).`);
    console.log("Проверь диф перед коммитом: git diff " + file);
    return;
  }

  console.log(
    [
      "Использование:",
      "  npm run diagram:link <файл>         — открыть диаграмму в mermaid.live",
      '  npm run diagram:pull <файл> "<url>" — забрать правки из mermaid.live обратно в файл',
      "",
      "URL берётся из адресной строки редактора целиком, в кавычках.",
    ].join("\n")
  );
  process.exitCode = 1;
}

main();
