import moment from "moment";
import puppeteer, { Browser, Page } from "puppeteer";
import { env } from "process";
import { lotteryResultScalpSchema } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const scrapperWebsite = "https://www.chineseproxy.net/index.php";

let browser: Browser | null = null;

async function getBrowserInstance() {
  try {
    if (!browser || browser.connected) {
      if (browser) {
        await browser.close().catch(console.error);
      }
      browser = await puppeteer.launch(
        env.NODE_ENV === "production"
          ? {
              headless: "shell",
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
              executablePath: "/usr/bin/chromium",
              // executablePath: '/snap/bin/chromium',
            }
          : {
              headless: true,
            }
      );
    }
    return browser;
  } catch (error) {
    console.error("Error launching browser:", error);
    throw error;
  }
}

async function createPage(): Promise<Page> {
  const browserInstance = await getBrowserInstance();
  try {
    const page = await browserInstance.newPage();
    // Set default timeout to avoid hanging
    page.setDefaultTimeout(30000);
    return page;
  } catch (error) {
    console.error("Error creating page:", error);
    throw error;
  }
}

async function closePage(page: Page | null) {
  if (page) {
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      console.error("Error closing page:", error);
    }
  }
}

async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.error("Error closing browser:", error);
    } finally {
      browser = null;
    }
  }
}

async function onScrap(page: Page, targetUrl: string) {
  try {
    await page.goto(scrapperWebsite, {
      waitUntil: "networkidle0", // Wait until network is idle
      timeout: 30000,
    });

    const urlInput = await page.waitForSelector("#url_textbox", {
      visible: true,
      timeout: 30000,
    });

    if (!urlInput) {
      throw new Error("URL input not found");
    }

    await urlInput.type(targetUrl);
    await page.keyboard.press("Enter");

    await page.waitForNavigation({
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    return page;
  } catch (error) {
    console.error("Error in onScrap:", error);
    throw error;
  }
}

export async function POST(request: Request) {
  let currentPage: Page | null = null;

  try {
    const body = await request.json();
    const parse = lotteryResultScalpSchema.safeParse(body);

    if (!parse.success) {
      return new Response(parse.error.message, { status: 400 });
    }

    const { column: _column, date, isVn, result_url } = body;
    const formattedDate = moment(date).format(
      isVn ? "DD-MM-YYYY" : "YYYY-MM-DD"
    );

    currentPage = await createPage();
    let lotteryResult = "";

    if (isVn) {
      let column = 0;
      switch (_column) {
        case "V1":
          column = 1;
          break;
        case "V2":
          column = 2;
          break;
        case "V3":
          column = 3;
          break;
      }

      if (result_url.includes("minhngoc")) {
        const targetUrl = `${result_url.replace(
          ".html",
          ""
        )}/${formattedDate}.html`;
        await onScrap(currentPage, targetUrl);
        if (result_url.includes("mien-bac")) {
          lotteryResult = await currentPage.evaluate(() => {
            const resultBox = document.querySelector(".box_kqxs");
            const prizes =
              resultBox?.querySelectorAll('td[class^="giai"] div') ?? [];
            return Array.from(prizes)
              .map((div) => div.innerHTML)
              .join("\n");
          }, column);
        } else {
          lotteryResult = await currentPage.evaluate((col) => {
            const resultBox = document.querySelector(".box_kqxs");
            const results = resultBox?.querySelector(
              `.content td:nth-of-type(2) td:nth-of-type(${col})`
            );
            const divs =
              results?.querySelectorAll('td[class^="giai"] div') ?? [];
            return Array.from(divs)
              .map((div) => div.innerHTML)
              .join("\n");
          }, column);
        }
      } else {
        const formattedDate = moment(date).format("YYYY-MM-DD");

        await currentPage.goto(
          `https://visothap.hanjery.com/?ket_qua_xo_so=${formattedDate}`,
          { waitUntil: "networkidle0", timeout: 60000 }
        );

        lotteryResult = await currentPage.evaluate(
          (col, title) => {
            const html = document.querySelector(".js-layout-content");
            const resultBoxes = html?.querySelectorAll(".js-space-item") ?? [];
            const results: string[] = [];

            resultBoxes.forEach((el) => {
              const resultTitle =
                el.querySelector(".js-header-title")?.innerHTML ?? "";
              if (resultTitle.includes(title)) {
                const resultRows = el.querySelectorAll(
                  ".js-table-tbody .js-table-row"
                );
                resultRows.forEach((resultRow, rowIndex) => {
                  if (rowIndex > 0) {
                    const cells = resultRow.querySelectorAll(".js-table-cell");
                    const rowCells =
                      cells[1]
                        ?.querySelector(".js-row")
                        ?.querySelectorAll(".js-col") ?? [];
                    rowCells.forEach((cell) => {
                      const text = cell.querySelector("div")?.innerHTML ?? "";
                      if (!text.includes("js-spin")) results.push(text);
                    });
                  }
                });
              }
            });
            return results.join("\n");
          },
          column,
          result_url
        );
      }
    } else {
      await currentPage.goto("http://khmerlottery.biz/", {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      await currentPage.waitForSelector('input.form-control[name="date"]', {
        timeout: 30000,
      });
      await currentPage.$eval(
        'input.form-control[name="date"]',
        (input) => (input.value = "")
      );
      await currentPage.type('input.form-control[name="date"]', formattedDate);
      await currentPage.click("button.btn.btn-default");
      await currentPage.waitForSelector(".table tbody", { timeout: 30000 });

      lotteryResult = await currentPage.evaluate((url) => {
        const resultBox = document.querySelector(".table tbody");
        const rows = resultBox?.querySelectorAll("tr") ?? [];
        const map = new Map<string, string[]>();

        rows.forEach((row) => {
          const cells = row.querySelectorAll("td");
          let shiftName = "";
          cells.forEach((cell, index) => {
            if (index > 0) {
              map.set(shiftName, [
                ...(map.get(shiftName) ?? []),
                cell.innerHTML,
              ]);
            } else {
              shiftName = cell.innerHTML;
              map.set(shiftName, []);
            }
          });
        });

        return map.get(url)?.join(" ") ?? "";
      }, result_url);
    }

    return new Response(lotteryResult);
  } catch (error) {
    console.error("Main error:", error);
    return new Response("An error occurred", { status: 500 });
  } finally {
    await closePage(currentPage);
    await closeBrowser();
  }
}
