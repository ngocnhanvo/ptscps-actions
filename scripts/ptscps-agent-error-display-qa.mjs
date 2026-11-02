import { chromium } from 'playwright';

const origin = process.env.FRONTEND_ORIGIN;
if (origin !== 'https://ptscps.thegioihosting.io.vn') {
  throw new Error('Agent UI QA blocked: unexpected frontend origin');
}
const browser = await chromium.launch({ headless: true });
try {
  for (const language of ['vi', 'en']) {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const errorMessage = language === 'vi'
      ? 'Dịch vụ AI không thể xử lý yêu cầu vì LLM đang gặp sự cố.'
      : 'The AI service cannot answer because its LLM provider is unavailable.';
    let intercepted = 0;
    await page.route('**/api/agent/chat', async (route) => {
      intercepted++;
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: errorMessage, code: 'llm_planner_failed' }) });
    });
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#ai-agent-btn').click();
    await page.locator('#ai-chat-box').evaluate((el, lang) => { el.dataset.agentLanguage = lang; }, language);
    await page.locator('#chat-input').fill('Simulate unavailable LLM');
    await page.locator('#chat-form').evaluate((form) => form.requestSubmit());
    const alert = page.locator('#chat-messages [role="alert"]').last();
    await alert.waitFor({ state: 'visible', timeout: 30000 });
    const message = await alert.innerText();
    if (intercepted !== 1 || !message.includes(errorMessage) || !message.includes('HTTP 503')
        || !message.includes('llm_planner_failed')) {
      throw new Error(`PTSCPS_AGENT_UI_LLM_FAILURE=FAIL lang=${language} intercepts=${intercepted}`);
    }
    // Fail closed: the mock is a transport error, not a fabricated natural-language answer.
    console.log(`PTSCPS_AGENT_UI_LLM_FAILURE=PASS lang=${language} http=503 code=llm_planner_failed alert=visible`);
    await page.close();
  }
} finally {
  await browser.close();
}
