import net from "node:net";

/**
 * Фейковый SMTP-сервер для интеграционных тестов.
 *
 * Зачем: движки отправки (sendEngine, warmupEngine) нельзя проверить, не дав им
 * реально отправить письмо — вся интересная логика (счётчики лимитов, sticky-ящик,
 * ramp прогрева) выполняется ПОСЛЕ успешного ответа SMTP. Мокать nodemailer
 * пришлось бы внутри движка, то есть тестировать не тот код, что работает в проде.
 * Поэтому поднимаем настоящий TCP-сокет, который говорит на минимальном SMTP.
 *
 * Умеет ровно столько, сколько нужно nodemailer: EHLO с объявлением AUTH,
 * AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO, DATA, QUIT. TLS не поддерживает —
 * поэтому тестовые ящики заводятся с smtpSecurity="STARTTLS" (secure=false),
 * а STARTTLS мы не объявляем, и nodemailer шлёт открытым текстом.
 *
 * failAuth=true заставляет сервер отвечать 535 на аутентификацию — так
 * проверяется ветка kind="auth" (ящик выбывает из ротации, connState=auth_error).
 */

export type ReceivedMail = {
  from: string;
  to: string[];
  /** Сырое тело письма вместе с заголовками (до точки-терминатора). */
  data: string;
};

export type FakeSmtp = {
  port: number;
  received: ReceivedMail[];
  /** Переключается прямо во время теста: следующая аутентификация упадёт. */
  failAuth: boolean;
  /** Письма, отправленные с этого адреса (удобно для проверок sticky-ящика). */
  sentFrom(email: string): ReceivedMail[];
  reset(): void;
  close(): Promise<void>;
};

function extractAddress(line: string): string {
  const m = /<([^>]*)>/.exec(line);
  if (m) return m[1];
  const parts = line.split(":");
  return (parts[1] ?? "").trim();
}

export async function startFakeSmtp(): Promise<FakeSmtp> {
  const received: ReceivedMail[] = [];
  const sockets = new Set<net.Socket>();
  const state = { failAuth: false };
  let queued = 0;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // сокет тестового сервера не должен держать процесс живым
    socket.on("error", () => socket.destroy());

    let buf = "";
    let inData = false;
    let authStage: "none" | "login-user" | "login-pass" | "plain-creds" = "none";
    let from = "";
    let to: string[] = [];

    const write = (line: string) => socket.write(line + "\r\n");

    const finishAuth = () => {
      authStage = "none";
      if (state.failAuth) write("535 5.7.8 Authentication credentials invalid");
      else write("235 2.7.0 Authentication successful");
    };

    const handleLine = (line: string) => {
      if (authStage === "login-user") {
        authStage = "login-pass";
        write("334 UGFzc3dvcmQ6"); // "Password:"
        return;
      }
      if (authStage === "login-pass" || authStage === "plain-creds") {
        finishAuth();
        return;
      }

      const upper = line.toUpperCase();

      if (upper.startsWith("EHLO")) {
        write("250-fake.smtp");
        write("250-AUTH PLAIN LOGIN");
        write("250 SIZE 10485760");
        return;
      }
      if (upper.startsWith("HELO")) {
        write("250 fake.smtp");
        return;
      }
      if (upper.startsWith("AUTH PLAIN")) {
        // креды могут прийти в той же строке ("AUTH PLAIN <base64>") или следующей
        if (line.trim().length > "AUTH PLAIN".length) finishAuth();
        else {
          authStage = "plain-creds";
          write("334 ");
        }
        return;
      }
      if (upper.startsWith("AUTH LOGIN")) {
        authStage = "login-user";
        write("334 VXNlcm5hbWU6"); // "Username:"
        return;
      }
      if (upper.startsWith("MAIL FROM")) {
        from = extractAddress(line);
        write("250 2.1.0 Ok");
        return;
      }
      if (upper.startsWith("RCPT TO")) {
        to.push(extractAddress(line));
        write("250 2.1.5 Ok");
        return;
      }
      if (upper.startsWith("DATA")) {
        inData = true;
        write("354 End data with <CR><LF>.<CR><LF>");
        return;
      }
      if (upper.startsWith("QUIT")) {
        write("221 2.0.0 Bye");
        socket.end();
        return;
      }
      if (upper.startsWith("RSET")) {
        from = "";
        to = [];
        write("250 2.0.0 Ok");
        return;
      }
      write("250 2.0.0 Ok");
    };

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // Разбираем накопленное в цикле: одна TCP-порция может содержать несколько
      // команд, а терминатор письма — приехать разорванным между порциями.
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return; // ждём остаток письма, буфер не трогаем
          received.push({ from, to: [...to], data: buf.slice(0, end) });
          buf = buf.slice(end + 5);
          inData = false;
          from = "";
          to = [];
          write(`250 2.0.0 Ok: queued as FAKE${++queued}`);
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        handleLine(line);
      }
    });

    write("220 fake.smtp ESMTP ready");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake SMTP: не удалось получить порт");
  const port = address.port;

  return {
    port,
    received,
    get failAuth() {
      return state.failAuth;
    },
    set failAuth(v: boolean) {
      state.failAuth = v;
    },
    sentFrom(email: string) {
      return received.filter((m) => m.from.toLowerCase() === email.toLowerCase());
    },
    reset() {
      received.length = 0;
      state.failAuth = false;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
