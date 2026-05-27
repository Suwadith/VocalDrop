const puppeteer = require('puppeteer');
const fs = require('fs');

async function run() {
  const dir = '/Volumes/External SSD/suwadith/Documents/antigravity/focused-fermi/screenshots';
  if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  
  try {
    // 1. Desktop - Search Page
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    console.log("Navigating to search page...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: `${dir}/desktop_search.png` });

    // 2. Desktop - Search Results
    console.log("Searching for a song...");
    await page.type('input[type="text"]', 'tamil songs');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 4000)); // wait for results
    await page.screenshot({ path: `${dir}/desktop_results.png` });

    // 3. Desktop - Player
    console.log("Clicking the first result...");
    const cards = await page.$$('h3');
    if (cards.length > 0) {
      await cards[0].click();
      await new Promise(r => setTimeout(r, 4000));
      await page.screenshot({ path: `${dir}/desktop_player.png` });
      
      // Switch to Karaoke Mode first
      console.log("Switching to Karaoke Mode...");
      await page.evaluate(() => {
        const modeBtn = document.querySelector('button[class*="modeToggle"]');
        if (modeBtn) modeBtn.click();
      });
      
      // Wait for separation to complete (karaoke button becomes enabled)
      console.log("Waiting for karaoke processing...");
      await new Promise(r => setTimeout(r, 15000));
      await page.screenshot({ path: `${dir}/desktop_karaoke_ready.png` });
      
      // 4. Desktop - Recording Studio
      console.log("Opening Recording Studio...");
      
      // Click the record button (it appears next to the karaoke toggle)
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button[class*="karaokeBtn"]');
        // buttons[0] is the mic toggle, buttons[1] is the record button
        if (buttons.length > 1) {
          buttons[1].click();
        }
      });
      await new Promise(r => setTimeout(r, 2000)); // wait for popup
      await page.screenshot({ path: `${dir}/desktop_recording_studio.png` });
      
      // close modal by pressing Escape
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 1000));
    }

    // 5. Mobile - Search Page
    console.log("Taking mobile screenshots...");
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await mobilePage.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    await mobilePage.screenshot({ path: `${dir}/mobile_search.png` });

    // 6. Mobile - Search Results
    await mobilePage.type('input[type="text"]', 'tamil songs');
    await mobilePage.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 4000));
    await mobilePage.screenshot({ path: `${dir}/mobile_results.png` });

    // 7. Mobile - Player
    const mcards = await mobilePage.$$('h3');
    if (mcards.length > 0) {
      await mcards[0].click();
      await new Promise(r => setTimeout(r, 4000));
      await mobilePage.screenshot({ path: `${dir}/mobile_player.png` });
    }

  } catch (err) {
    console.error("Error during screenshots:", err);
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
