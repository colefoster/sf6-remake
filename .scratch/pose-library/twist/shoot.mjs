import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 900 }, deviceScaleFactor: 2 });
for (const name of ["punches", "retarget"]) {
  await page.goto(`http://127.0.0.1:8788/.scratch/pose-library/twist/${name}.html?v=${Date.now()}`, {
    waitUntil: "networkidle",
  });
  await page.screenshot({ path: `.scratch/pose-library/twist/${name}.png`, fullPage: true });
  console.log(`.scratch/pose-library/twist/${name}.png`);
}
await browser.close();
