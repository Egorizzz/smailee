import { loadEnvConfig } from "@next/env";
import { mkdir } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";

async function main() {
  loadEnvConfig(process.cwd());

  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
  const outputDir = "tmp/product-screen-hires";
  const viewport = { width: 1440, height: 1000 };
  const deviceScaleFactor = 2;

  await mkdir(outputDir, { recursive: true });

  const user = await prisma.user.findFirst({
  where: {
    ownedOrganization: { demoWorkspace: { status: "ACTIVE" } },
    mustChangePassword: false,
  },
  select: { id: true, email: true },
  orderBy: { createdAt: "asc" },
  });

if (!user) throw new Error("Не найден пользователь с активным демо-пространством");

  const jwtSecret = process.env.JWT_SECRET && process.env.JWT_SECRET !== "dev-insecure-secret-change-me"
  ? process.env.JWT_SECRET
  : "dev-insecure-secret-change-me";
  const session = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: 60 * 30 });

  const executablePath = process.env.SCREENSHOT_BROWSER_PATH
    ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
  viewport,
  deviceScaleFactor,
  colorScheme: "light",
  reducedMotion: "reduce",
  });

  await context.addCookies([{
  name: "smailee_session",
  value: session,
  url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }, {
    name: "smailee_cookie_consent",
    value: encodeURIComponent(JSON.stringify({
      version: "2026-08-17",
      necessary: true,
      analytics: false,
      decidedAt: new Date().toISOString(),
    })),
    url: baseUrl,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();

  async function capture(name: string, path: string, prepare?: (page: Page) => Promise<void>) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    if (prepare) await prepare(page);
    await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })));
    });
    await page.screenshot({
    path: `${outputDir}/${name}.png`,
    type: "png",
    animations: "disabled",
    caret: "hide",
    });
  }

  await capture("profile-ai-2x-source", "/app/settings/profile");
  await capture("prospecting-results-2x-source", "/app/contacts/discover");
  await capture("prospecting-criteria-2x-source", "/app/contacts/discover", async (activePage) => {
    await activePage.getByRole("button", { name: "Новый поиск" }).click();
    await activePage.waitForTimeout(300);
  });
  await capture("inbox-2x-source", "/app/inbox?thread=cmt5s3who00pb2gsottouw7hf");
  await capture("mailboxes-2x-source", "/app/mailboxes");
  await capture("analytics-2x-source", "/app/analytics");
  await capture("composer-2x-source", "/app/campaigns/new", async (activePage) => {
    await activePage.getByLabel("Название кампании").fill("Холодная база — юристы");
    await activePage.getByRole("button", { name: "IT и разработка" }).click();
    await activePage.getByRole("button", { name: /Дальше: письмо/ }).click();
    await activePage.getByLabel("Тема письма").fill("Идея для {{company}} от ТвойЗонт");
    await activePage.getByLabel("Текст письма").fill([
      "{{greeting}},",
      "",
      "Посмотрел, как {{company}} работает с сотрудниками и посетителями. Кажется, сервис аренды зонтов может снять одну небольшую, но регулярную проблему в дождливые дни.",
      "",
      "{{company_observation}}",
      "",
      "Будет уместно коротко обсудить пилот на этой неделе?",
    ].join("\n"));
    await activePage.waitForTimeout(300);
  });

  const crop = async (source: string, target: string, area: { left: number; top: number; width: number; height: number }) => {
    await sharp(`${outputDir}/${source}.png`)
      .extract(area)
      .png({ compressionLevel: 9, palette: false })
      .toFile(`public/product-screens/${target}.png`);
  };

  await crop("profile-ai-2x-source", "profile-ai-tight-hd", { left: 930, top: 800, width: 1520, height: 960 });
  await crop("prospecting-criteria-2x-source", "prospecting-criteria-focus-hd", { left: 600, top: 880, width: 720, height: 900 });
  await crop("prospecting-results-2x-source", "prospecting-results-focus-hd", { left: 600, top: 520, width: 2280, height: 1460 });
  await crop("composer-2x-source", "composer-focus-hd", { left: 680, top: 500, width: 1400, height: 1200 });
  await crop("inbox-2x-source", "inbox-conversation-tight-hd", { left: 1230, top: 760, width: 1650, height: 1200 });
  await crop("inbox-2x-source", "inbox-dialog-feature-hd", { left: 1230, top: 1280, width: 1650, height: 700 });
  await crop("inbox-2x-source", "inbox-lead-tight-hd", { left: 1230, top: 220, width: 1650, height: 420 });
  await crop("mailboxes-2x-source", "mailboxes-tight-hd", { left: 800, top: 450, width: 1770, height: 640 });
  await crop("analytics-2x-source", "analytics-crop-hd", { left: 620, top: 520, width: 2160, height: 1240 });
  await crop("analytics-2x-source", "sent-funnel-hd", { left: 650, top: 740, width: 2100, height: 560 });
  await crop("analytics-2x-source", "warm-leads-tight-hd", { left: 650, top: 1350, width: 850, height: 500 });

  await browser.close();
  await prisma.$disconnect();

  console.log(`Lossless 2x PNG сохранены в ${outputDir}`);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
