const SUPPORTED_EXTENSIONS = new Set(["txt", "csv", "md"]);

export const MAX_DIALOG_FILE_BYTES = 2_000_000;
export const MAX_DIALOG_ANALYSIS_CHARS = 48_000;

export class DialogImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DialogImportError";
  }
}

export function validateDialogFile(name: string, size: number) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new DialogImportError("Поддерживаются файлы TXT, CSV и MD");
  }
  if (size > MAX_DIALOG_FILE_BYTES) {
    throw new DialogImportError("Файл больше 2 МБ — оставьте самые показательные диалоги");
  }
}

function decode(bytes: Uint8Array, encoding: string, offset = 0) {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
}

function controlRatio(text: string) {
  if (!text) return 1;
  const controls = [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && char !== "\n" && char !== "\r" && char !== "\t";
  }).length;
  return controls / text.length;
}

function naturalTextScore(text: string) {
  const natural = [...text].filter((char) => /[\p{L}\p{N}\s.,:;!?@()\-—«»"']/u.test(char)).length;
  return natural / Math.max(1, text.length) - controlRatio(text) * 10;
}

/** Декодирует типичные русскоязычные выгрузки и отсекает бинарные файлы. */
export function decodeDialogFile(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = decode(bytes, "utf-8", 3);
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decode(bytes, "utf-16le", 2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decode(bytes, "utf-16be", 2);
  } else {
    try {
      text = decode(bytes, "utf-8");
      // У UTF-16 без BOM байты иногда формально валидны как UTF-8, но дают
      // множество управляющих символов. В этом случае выбираем естественнее
      // выглядящий вариант LE/BE, а не принимаем испорченный текст.
      if (controlRatio(text) > 0.01 && bytes.length % 2 === 0) {
        const utf16Candidates = [decode(bytes, "utf-16le"), decode(bytes, "utf-16be")];
        text = utf16Candidates.sort((a, b) => naturalTextScore(b) - naturalTextScore(a))[0];
      }
    } catch {
      // Старые CSV-выгрузки из русскоязычных CRM часто сохранены в CP1251.
      text = decode(bytes, "windows-1251");
    }
  }

  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  const controls = [...normalized].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && char !== "\n" && char !== "\t";
  }).length;
  if (!normalized || controls > Math.max(8, normalized.length * 0.01)) {
    throw new DialogImportError("Не удалось прочитать файл как текст. Загрузите TXT, CSV или MD");
  }
  return normalized;
}

/** Файл и вставленный текст — независимые источники, поэтому объединяем их. */
export function combineDialogSources(input: {
  fileText?: string;
  fileName?: string;
  pastedText?: string;
}): string {
  const parts: string[] = [];
  if (input.fileText?.trim()) {
    parts.push(`[Диалоги из файла ${input.fileName || "без названия"}]\n${input.fileText.trim()}`);
  }
  if (input.pastedText?.trim()) {
    parts.push(`[Диалоги, вставленные текстом]\n${input.pastedText.trim()}`);
  }
  return parts.join("\n\n");
}

/** Берёт репрезентативные части начала, середины и конца большой выгрузки. */
export function sampleDialogCorpus(text: string, maxChars = MAX_DIALOG_ANALYSIS_CHARS) {
  if (text.length <= maxChars) return { text, sampled: false };
  const marker = "\n\n[…часть длинной выгрузки пропущена…]\n\n";
  const available = maxChars - marker.length * 2;
  const chunk = Math.floor(available / 3);
  const middleStart = Math.max(0, Math.floor(text.length / 2 - chunk / 2));
  return {
    text: [
      text.slice(0, chunk),
      text.slice(middleStart, middleStart + chunk),
      text.slice(-chunk),
    ].join(marker),
    sampled: true,
  };
}
