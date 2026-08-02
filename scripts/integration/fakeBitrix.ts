import http from "node:http";

/**
 * Фейковый портал Битрикс24 для интеграционных тестов.
 *
 * Зачем настоящий HTTP-сервер, а не мок функции: интересна как раз работа
 * адаптера целиком — что он соберёт правильный URL из вебхука, отправит поля
 * в ожидаемом виде и корректно разберёт ответ. Подменять сам pushLead значило
 * бы тестировать заглушку вместо кода, который поедет в прод.
 *
 * Отвечает на два метода: profile (используется при проверке вебхука перед
 * сохранением) и crm.lead.add (передача лида).
 */

export type ReceivedLead = {
  title: string;
  name: string;
  email: string;
  comments: string;
};

export type FakeBitrix = {
  /** Готовая ссылка вебхука — кладётся клиенту как настоящая. */
  webhookUrl: string;
  leads: ReceivedLead[];
  /** Переключается в тесте: портал начинает отвечать ошибкой. */
  failNext: boolean;
  reset(): void;
  close(): Promise<void>;
};

export async function startFakeBitrix(): Promise<FakeBitrix> {
  const leads: ReceivedLead[] = [];
  const state = { failNext: false };
  let nextId = 100;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const send = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (state.failNext) {
        // формат ошибки — как у настоящего Битрикса
        send({ error: "ACCESS_DENIED", error_description: "Недостаточно прав" });
        return;
      }

      const url = req.url ?? "";
      if (url.endsWith("/profile.json")) {
        send({ result: { NAME: "Тест", LAST_NAME: "Портал" } });
        return;
      }

      if (url.endsWith("/crm.lead.add.json")) {
        let fields: Record<string, unknown> = {};
        try {
          fields = (JSON.parse(body) as { fields?: Record<string, unknown> }).fields ?? {};
        } catch {
          // невалидный JSON от нас — пусть тест это увидит как пустой лид
        }
        const emails = (fields.EMAIL as { VALUE?: string }[] | undefined) ?? [];
        leads.push({
          title: String(fields.TITLE ?? ""),
          name: String(fields.NAME ?? ""),
          email: String(emails[0]?.VALUE ?? ""),
          comments: String(fields.COMMENTS ?? ""),
        });
        send({ result: nextId++ });
        return;
      }

      send({ error: "ERROR_METHOD_NOT_FOUND", error_description: "Метод не найден" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake Bitrix: не удалось получить порт");
  }

  return {
    // вид совпадает с настоящим вебхуком: .../rest/<user>/<token>/
    webhookUrl: `http://127.0.0.1:${address.port}/rest/1/testtoken/`,
    leads,
    get failNext() {
      return state.failNext;
    },
    set failNext(v: boolean) {
      state.failNext = v;
    },
    reset() {
      leads.length = 0;
      state.failNext = false;
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
