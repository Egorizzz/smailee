import sharp from "sharp";

const input = "public/product-screens/integrations-bitrix-tight-hd.png";
const output = "public/product-screens/integrations-bitrix-connected-hd.png";

const badge = Buffer.from(`
  <svg width="920" height="560" xmlns="http://www.w3.org/2000/svg">
    <rect x="620" y="43" width="250" height="71" fill="#ffffff" />
    <rect x="654" y="54" width="199" height="48" rx="24" fill="#eaf7f0" />
    <text
      x="753.5"
      y="85.5"
      text-anchor="middle"
      font-family="Segoe UI, Arial, sans-serif"
      font-size="25"
      font-weight="600"
      fill="#2f7d57"
    >Подключено</text>
  </svg>
`);

await sharp(input)
  .composite([{ input: badge, top: 0, left: 0 }])
  .png({ compressionLevel: 9 })
  .toFile(output);

console.log(output);
