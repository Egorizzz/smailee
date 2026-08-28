import { loadEnvConfig } from "@next/env";
import { access, mkdir } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { chromium } from "playwright";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";

const OUTPUT_DIR = "tmp/product-screen-hires";

async function main() {
  loadEnvConfig(process.cwd());

  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
  await mkdir(OUTPUT_DIR, { recursive: true });

  const user = await prisma.user.findFirst({
    where: {
      name: "Админ",
      ownedOrganization: { isNot: null },
      mustChangePassword: false,
    },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  if (!user) throw new Error("Не найден пользователь-владелец кабинета");

  const jwtSecret = process.env.JWT_SECRET && process.env.JWT_SECRET !== "dev-insecure-secret-change-me"
    ? process.env.JWT_SECRET
    : "dev-insecure-secret-change-me";
  const session = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: 60 * 30 });
  const executablePath = process.env.SCREENSHOT_BROWSER_PATH
    ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  });

  await context.addCookies([{
    name: "smailee_session",
    value: session,
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/app/integrations`, { waitUntil: "networkidle" });
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
    path: `${OUTPUT_DIR}/integrations-2x-source.png`,
    type: "png",
    animations: "disabled",
    caret: "hide",
  });

  await sharp(`${OUTPUT_DIR}/integrations-2x-source.png`)
    .extract({ left: 800, top: 220, width: 920, height: 560 })
    .png({ compressionLevel: 9, palette: false })
    .toFile("public/product-screens/integrations-bitrix-tight-hd.png");

  const inboxSource = `${OUTPUT_DIR}/inbox-2x-source.png`;
  await access(inboxSource);
  await sharp(inboxSource)
    .extract({ left: 544, top: 450, width: 704, height: 520 })
    .png({ compressionLevel: 9, palette: false })
    .toFile("public/product-screens/inbox-list-tight-hd.png");

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
