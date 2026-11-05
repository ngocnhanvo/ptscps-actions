import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
assert(front && wp, 'FRONT_ORIGIN/WP_ORIGIN missing');
const frontUrl = new URL(front);
const wpUrl = new URL(wp);
assert(frontUrl.protocol === 'https:' && wpUrl.protocol === 'https:', 'HTTPS origins required');
assert(frontUrl.origin !== wpUrl.origin, 'Frontend and WordPress origins must differ');

const services = [
  { title: 'Vận hành và bảo dưỡng FPSO/FSO/MOPU', slug: 'van-hanh-va-bao-duong-fpso-fso-mopu' },
  { title: 'Dịch vụ thiết kế, mua sắm, gia công, chế tạo', slug: 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao' },
  { title: 'Cung ứng nhân lực kỹ thuật vận hành và bảo dưỡng', slug: 'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong' },
  { title: 'Dịch vụ sửa chữa bảo dưỡng các thiết bị và công trình công nghiệp', slug: 'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep' },
];
const expectedTitles = services.map((item) => item.title);
const artifactDir = 'artifacts/ptscps-services-readonly-qa';
await mkdir(artifactDir, { recursive: true });
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const noAdminOrigin = (html, label) => {
  assert(!html.includes(wpUrl.origin), `${label} WordPress admin origin leaked`);
  assert(!html.includes(wpUrl.hostname), `${label} WordPress admin hostname leaked`);
};

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const response = await page.goto(`${front}/dich-vu?_readonly_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `${viewport.name} /dich-vu HTTP ${response?.status()}`);
    assert(new URL(page.url()).origin === frontUrl.origin, `${viewport.name} redirected outside frontend origin`);

    const cards = page.locator('[data-services-category-grid] a');
    assert.equal(await cards.count(), 4, `${viewport.name} service card count mismatch`);
    const names = (await cards.locator('h2').allTextContents()).map(clean);
    assert.deepEqual(names, expectedTitles, `${viewport.name} category order mismatch`);

    const hrefs = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') || ''));
    const destinations = hrefs.map((href) => new URL(href, frontUrl.origin));
    assert(destinations.every((url) => url.origin === frontUrl.origin), `${viewport.name} category link leaves frontend origin`);
    assert.deepEqual(destinations.map((url) => url.pathname), services.map((item) => `/dich-vu/${item.slug}`), `${viewport.name} category href mismatch`);
    assert((await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('target') || ''))).every((target) => target !== '_blank'), `${viewport.name} category link opens new tab`);

    const images = cards.locator('img');
    assert.equal(await images.count(), 4, `${viewport.name} service image count mismatch`);
    for (let i = 0; i < 4; i += 1) {
      await images.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-services-category-grid] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const srcs = await images.evaluateAll((nodes) => nodes.map((img) => img.getAttribute('src') || ''));
    assert(srcs.every((src) => src.startsWith('/images/')), `${viewport.name} category images did not use processed ESC image objects`);

    noAdminOrigin(await page.content(), viewport.name);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(overflow.scroll <= overflow.client + 2, `${viewport.name} horizontal overflow`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_ROUTE=${viewport.name}:PASS`);

    const detail = services[0];
    const detailResponse = await page.goto(`${front}/dich-vu/${detail.slug}?_detail_visual_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(detailResponse?.status() === 200, `${viewport.name} service detail HTTP ${detailResponse?.status()}`);
    assert(await page.locator('[data-service-category-description]').isVisible(), `${viewport.name} service intro missing`);
    assert(await page.locator('[data-service-projects-heading]').isVisible(), `${viewport.name} projects heading missing`);
    const searchForm = page.locator('#search-form');
    if (await searchForm.count()) assert(!(await searchForm.isVisible()), `${viewport.name} catalog search/filter leaked into service detail`);
    const projectCards = page.locator('[data-service-projects-heading] + div article');
    assert.equal(await projectCards.count(), 7, `${viewport.name} featured project card count mismatch`);
    const metrics = await projectCards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    }));
    if (viewport.name === 'desktop') {
      assert(metrics.every((item) => item.width >= 1000), 'desktop service project cards should use the full content row');
      assert(metrics.every((item, index) => index === 0 || item.y > metrics[index - 1].y + 100), 'desktop service detail should use one project per row');
      const xPositions = metrics.map((item) => item.x);
      assert(Math.max(...xPositions) - Math.min(...xPositions) <= 4, 'desktop service project rows should share one left edge');
    } else {
      assert(metrics.every((item) => item.width >= 340), 'mobile service project cards should use the full content width');
      assert(metrics.length < 2 || metrics[1].y > metrics[0].y + 100, 'mobile service detail should use one project column');
    }
    const firstProjectBox = await projectCards.first().boundingBox();
    const mediaBox = await page.locator('[data-service-projects-heading] + div article > a > div').first().boundingBox();
    assert(firstProjectBox && mediaBox, `${viewport.name} project card/media box missing`);
    if (viewport.name === 'desktop') {
      assert(Math.abs(mediaBox.height - firstProjectBox.height) <= 4, 'desktop service media should fill the full compact card height');
      assert(firstProjectBox.height <= 460, 'desktop service project card still has excessive empty height');
    } else {
      assert(mediaBox.width / mediaBox.height > 1.25 && mediaBox.width / mediaBox.height < 1.42, 'mobile project media is not approximately 4:3');
    }
    const projectImages = projectCards.locator('img');
    assert.equal(await projectImages.count(), await projectCards.count(), `${viewport.name} service projects should show exactly one representative image per card`);
    assert.equal(await projectCards.locator('[data-service-project-gallery]').count(), 0, `${viewport.name} service project gallery should not render`);
    for (let i = 0; i < await projectImages.count(); i += 1) {
      await projectImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-projects-heading] + div article img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const scopeMetrics = await projectCards.locator('[data-service-project-scope]').evaluateAll((nodes) => nodes.map((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    })));
    assert(scopeMetrics.every((item) => item.scrollHeight <= item.clientHeight + 2), `${viewport.name} service project description is visually truncated`);
    assert(scopeMetrics.every((item) => item.overflow !== 'hidden'), `${viewport.name} service project description still hides overflow`);
    const detailOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(detailOverflow.scroll <= detailOverflow.client + 2, `${viewport.name} detail horizontal overflow`);
    noAdminOrigin(await page.content(), `${viewport.name}-service-detail`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-fpso-detail.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_DETAIL=${viewport.name}:PASS`);

    const designService = services.find((item) => item.slug === 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao');
    assert(designService, 'Design/procurement service fixture missing');
    const designResponse = await page.goto(`${front}/dich-vu/${designService.slug}?_design_detail_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(designResponse?.status() === 200, `${viewport.name} design service detail HTTP ${designResponse?.status()}`);
    const designDescription = page.locator('[data-service-category-description]');
    assert(await designDescription.isVisible(), `${viewport.name} design service description missing`);
    const designText = clean(await designDescription.textContent());
    assert(designText.includes('dịch vụ EPCI'), `${viewport.name} design EPCI introduction missing`);

    const expectedCapabilities = [
      'Skid fabrication (including valve, pump, process skid…)',
      'Piping and structural fabrication',
      'Pressure vessel, tank fabrication',
      'E&I system (Metering, ICSS, cathodic protection)',
    ];
    const capabilityGallery = page.locator('[data-service-capability-gallery]');
    assert(await capabilityGallery.isVisible(), `${viewport.name} design capability gallery missing`);
    const capabilityFigures = capabilityGallery.locator('figure');
    assert.equal(await capabilityFigures.count(), 4, `${viewport.name} design capability count mismatch`);
    assert.deepEqual((await capabilityFigures.locator('figcaption').allTextContents()).map(clean), expectedCapabilities, `${viewport.name} design capability labels mismatch`);
    const capabilityImages = capabilityFigures.locator('img');
    assert.equal(await capabilityImages.count(), 4, `${viewport.name} design capability image count mismatch`);
    for (let i = 0; i < 4; i += 1) {
      await capabilityImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-capability-gallery] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }

    const expectedProjects = [
      {
        title: 'Dự án Trạm Thu gom và phân phối khí Thái Bình – Hàm Rồng',
        slug: 'tram-thu-gom-va-phan-phoi-khi-thai-binh-ham-rong',
        scope: 'Thiết kế, mua sắm, thi công chế tạo chạy thử cho 18 gói cụm, hệ thống thiết bị cho dự án trạm thu gom và phân phối khí Thái Bình – Hàm Rồng bao gồm hệ thống Corrosion Inhibitor Skid, Pig Launcher – Pig Receiver, Piping system of platform, Hot tap flange, Piping on GDC-LFS, Valve skid, Fire fighting system, Hydrate system, Separator, Heat Exchanger, Flare, Truck Loading System, Oil Water Treatment, ICSS, Metering System, Electrical System và Cathodic Protection.',
      },
      {
        title: 'Dự án Metering Skid – Thu gom khí Đại Hùng',
        slug: 'metering-skid-thu-gom-khi-dai-hung',
        scope: 'Thiết kế, mua sắm, chế tạo và chạy thử 01 hệ thống Gas Custody Metering (Tag. No 36A001).',
      },
      {
        title: 'Dự án Chemical Injection Skid – Giàn Đông Đô',
        slug: 'chemical-injection-skid-gian-dong-do',
        scope: 'Thiết kế, mua sắm, chế tạo, lắp đặt chạy thử 01 hệ thống bơm H2 Scavenger Injection Pump trên giàn Đông Đô.',
      },
      {
        title: 'Dự án Condensate Tank TK-8040 for NPK Project',
        slug: 'condensate-tank-tk-8040-npk-project',
        scope: 'Thiết kế, mua sắm, chế tạo 01 condensate tank (TK-8040).',
      },
      {
        title: 'Dự án cung cấp năng lượng sạch và chiếu sáng cho Quần đảo Trường Sa',
        slug: 'nang-luong-sach-chieu-sang-quan-dao-truong-sa',
        scope: 'Mua sắm, chế tạo, lắp đặt các kết cấu thép cho dự án cấp năng lượng và chiếu sáng cho Quần đảo Trường Sa.',
      },
    ];
    assert(await page.locator('[data-service-projects-heading]').isVisible(), `${viewport.name} design project heading missing`);
    const designProjectCards = page.locator('[data-service-projects-heading] + div article');
    assert.equal(await designProjectCards.count(), 5, `${viewport.name} design project card count mismatch`);
    const designMetrics = await designProjectCards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    }));
    assert(designMetrics.every((item, index) => index === 0 || item.y > designMetrics[index - 1].y + 100), `${viewport.name} design service should use one project per row`);
    assert(designMetrics.every((item) => item.width >= (viewport.name === 'desktop' ? 1000 : 340)), `${viewport.name} design project row width mismatch`);
    const designFirstProjectBox = await designProjectCards.first().boundingBox();
    const designMediaBox = await designProjectCards.first().locator(':scope > a > div').boundingBox();
    assert(designFirstProjectBox && designMediaBox, `${viewport.name} design project card/media box missing`);
    if (viewport.name === 'desktop') {
      assert(Math.abs(designMediaBox.height - designFirstProjectBox.height) <= 4, 'desktop design project media should fill the full compact card height');
      assert(designFirstProjectBox.height <= 560, 'desktop design project card still has excessive empty height');
    } else {
      assert(designMediaBox.width / designMediaBox.height > 1.25 && designMediaBox.width / designMediaBox.height < 1.42, 'mobile design project media is not approximately 4:3');
    }
    assert.deepEqual((await designProjectCards.locator('h2').allTextContents()).map(clean), expectedProjects.map((item) => item.title), `${viewport.name} design project titles mismatch`);
    const designScopes = (await designProjectCards.locator('[data-service-project-scope]').allTextContents()).map(clean);
    assert.deepEqual(designScopes, expectedProjects.map((item) => item.scope), `${viewport.name} design project scopes mismatch`);
    const designScopeMetrics = await designProjectCards.locator('[data-service-project-scope]').evaluateAll((nodes) => nodes.map((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    })));
    assert(designScopeMetrics.every((item) => item.scrollHeight <= item.clientHeight + 2), `${viewport.name} design project scope is visually truncated`);
    assert(designScopeMetrics.every((item) => item.overflow !== 'hidden'), `${viewport.name} design project scope still hides overflow`);
    const designProjectImages = designProjectCards.locator('img');
    assert.equal(await designProjectImages.count(), await designProjectCards.count(), `${viewport.name} design projects should show exactly one representative image per card`);
    assert.equal(await designProjectCards.locator('[data-service-project-gallery]').count(), 0, `${viewport.name} design project gallery should not render`);
    for (let i = 0; i < await designProjectImages.count(); i += 1) {
      await designProjectImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-projects-heading] + div article img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const designHrefs = await designProjectCards.evaluateAll((nodes) => nodes.map((node) => node.querySelector('a')?.getAttribute('href') || ''));
    assert.deepEqual(designHrefs.map((href) => new URL(href, frontUrl.origin).pathname), expectedProjects.map((item) => `/dich-vu/${item.slug}`), `${viewport.name} design project href mismatch`);
    assert(designHrefs.every((href) => new URL(href, frontUrl.origin).origin === frontUrl.origin), `${viewport.name} design project link leaves frontend origin`);
    assert(!designText.includes(expectedProjects[0].title), `${viewport.name} design project data duplicated in category description`);
    const designOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(designOverflow.scroll <= designOverflow.client + 2, `${viewport.name} design detail horizontal overflow`);
    noAdminOrigin(await page.content(), `${viewport.name}-design-service-detail`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-thiet-ke-detail.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_DESIGN=${viewport.name}:PASS capabilities=4 projects=5 project_images=5`);
    const repairService = services.find((item) => item.slug === 'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep');
    assert(repairService, 'Repair service fixture missing');
    const repairChildren = [
      { title: 'Dịch vụ Bảo dưỡng, sửa chữa thiết bị tĩnh, thiết bị quay, thiết bị điện và tự động hóa', slug: 'dich-vu-bao-duong-sua-chua-thiet-bi-tinh-thiet-bi-quay-thiet-bi-dien-va-tu-dong-hoa' },
      { title: 'Vận hành và bảo dưỡng sửa chữa các nhà máy, các công trình công nghiệp', slug: 'van-hanh-va-bao-duong-sua-chua-cac-nha-may-cac-cong-trinh-cong-nghiep' },
      { title: 'Các dịch vụ khác', slug: 'cac-dich-vu-khac' },
    ];
    const repairSummaryNeedles = [
      ['thiết bị tĩnh', '300KW'],
      ['Dung Quất', 'FPSO Ruby II'],
      ['giàn giáo', 'OCIMF', 'UTM'],
    ];
    const repairProjectTitles = [
      'Dự án bảo dưỡng sửa chữa van trong đợt bảo dưỡng tổng thể lần 4 – Nhà máy lọc dầu Dung Quất',
      'Dự án cung cấp quy trình bảo dưỡng, bảo dưỡng hàng ngày, bảo dưỡng chiến dịch cho trạm nạp liệu ngầm sân bay Tân Sơn Nhất',
      'Dự án bảo dưỡng sửa chữa và cung cấp vật tư cho toàn bộ van đường ống cho nhà máy Lọc hóa dầu Nghi Sơn',
      'Dự án kiểm tra, hiệu chỉnh và sửa chữa van an toàn thuộc Gói 1 – PSV dự án DCSM (Turnaround) cho nhà máy Lọc hóa dầu Nghi Sơn',
      'Thực hiện dịch vụ sửa chữa turbine hơi cho Nhà máy đạm Phú Mỹ',
      'Dự án bảo dưỡng, sửa chữa van tại Nhà máy lọc hóa dầu Bình Sơn',
      'Dự án sửa chữa tank két trên tàu FPSO RUBY II cho khách hàng VOFT',
      'Bảo dưỡng, sửa chữa ống Floating Hose trên tàu FSO MV17 cho khách hàng MODEC',
    ];

    const repairParentResponse = await page.goto(`${front}/dich-vu/${repairService.slug}?_repair_parent_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(repairParentResponse?.status() === 200, `${viewport.name} repair parent HTTP ${repairParentResponse?.status()}`);
    assert.equal(clean(await page.locator('h1').first().textContent()), repairService.title, `${viewport.name} repair parent H1 mismatch`);
    const repairParentDescription = page.locator('[data-service-category-description]');
    assert(await repairParentDescription.isVisible(), `${viewport.name} repair parent description missing`);
    const repairParentText = clean(await repairParentDescription.textContent());
    assert(repairParentText.includes('5000m2'), `${viewport.name} repair workshop introduction missing`);
    assert(!repairParentText.includes('ASME'), `${viewport.name} repair ASME content duplicated in taxonomy description`);
    const repairDetailContent = page.locator('[data-service-detail-content]');
    assert(await repairDetailContent.isVisible(), `${viewport.name} repair ESC Table detail content missing`);
    assert(clean(await repairDetailContent.textContent()).includes('ASME'), `${viewport.name} repair ASME introduction missing`);
    const repairDetailBlocks = repairDetailContent.locator('[data-service-detail-block]');
    assert.deepEqual(await repairDetailBlocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-service-detail-block') || '')), ['image', 'prose', 'certificates', 'service-heading'], `${viewport.name} repair detail block order mismatch`);
    const repairParentImages = repairDetailContent.locator('img');
    assert.equal(await repairParentImages.count(), 3, `${viewport.name} repair parent legacy media count mismatch`);
    assert.deepEqual(await repairParentImages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('alt') || '')), ['Xưởng cơ khí bảo dưỡng PTSC', 'Chứng chỉ ASME U', 'Chứng chỉ ASME S'], `${viewport.name} repair parent media order/alt mismatch`);
    const repairCertificateGrid = repairDetailContent.locator('[data-service-certificates]');
    assert.equal(await repairCertificateGrid.count(), 1, `${viewport.name} repair certificate grid missing`);
    assert.equal(await repairCertificateGrid.locator('img').count(), 2, `${viewport.name} repair certificate count mismatch`);
    const repairDetailHeading = repairDetailContent.locator('[data-service-detail-heading]');
    assert.equal(clean(await repairDetailHeading.textContent()), 'Các dịch vụ sửa chữa bảo dưỡng được Công ty thực hiện bao gồm:', `${viewport.name} repair detail service heading mismatch`);
    for (let i = 0; i < 3; i += 1) {
      await repairParentImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-detail-content] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const certificateBoxes = await repairCertificateGrid.locator('figure').evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y) }; }));
    assert.equal(certificateBoxes.length, 2, `${viewport.name} repair certificate layout items missing`);
    if (viewport.name === 'desktop') assert(Math.abs(certificateBoxes[0].y - certificateBoxes[1].y) <= 4 && certificateBoxes[1].x > certificateBoxes[0].x, 'desktop repair certificates should render side-by-side');
    else assert(certificateBoxes[1].y > certificateBoxes[0].y + 20, 'mobile repair certificates should stack vertically');
    const repairGroups = page.locator('[data-service-subcategory-row]');
    assert.equal(await repairGroups.count(), 3, `${viewport.name} repair child service count mismatch`);
    assert.deepEqual((await repairGroups.locator('h3').allTextContents()).map(clean), repairChildren.map((item) => item.title), `${viewport.name} repair child service labels mismatch`);
    const repairGroupSummaries = repairGroups.locator('[data-service-subcategory-summary]');
    assert.equal(await repairGroupSummaries.count(), 3, `${viewport.name} repair child service summary count mismatch`);
    const repairSummaryTexts = (await repairGroupSummaries.allTextContents()).map(clean);
    assert(repairSummaryTexts.every((text) => text.length >= 120), `${viewport.name} repair child service summary too short`);
    for (let index = 0; index < repairSummaryNeedles.length; index += 1) {
      for (const phrase of repairSummaryNeedles[index]) {
        assert(repairSummaryTexts[index].includes(phrase), `${viewport.name} repair child service summary missing ${phrase}`);
      }
    }
    const repairSummaryMetrics = await repairGroupSummaries.evaluateAll((nodes) => nodes.map((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    })));
    assert(repairSummaryMetrics.every((item) => item.scrollHeight <= item.clientHeight + 2), `${viewport.name} repair child service summary is visually truncated`);
    assert(repairSummaryMetrics.every((item) => item.overflow !== 'hidden'), `${viewport.name} repair child service summary hides overflow`);
    const repairGroupBoxes = await repairGroups.evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) }; }));
    assert.equal(repairGroupBoxes.length, 3, `${viewport.name} repair child service row boxes missing`);
    for (let index = 1; index < repairGroupBoxes.length; index += 1) {
      assert(repairGroupBoxes[index].y > repairGroupBoxes[index - 1].y + 40, `${viewport.name} repair child services should render one service per row`);
      assert(Math.abs(repairGroupBoxes[index].x - repairGroupBoxes[0].x) <= 4, `${viewport.name} repair child service rows should share the same left edge`);
      assert(Math.abs(repairGroupBoxes[index].width - repairGroupBoxes[0].width) <= 4, `${viewport.name} repair child service rows should share the same width`);
    }
    const repairGroupHrefs = await repairGroups.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') || ''));
    assert.deepEqual(repairGroupHrefs.map((href) => new URL(href, frontUrl.origin).pathname), repairChildren.map((item) => `/dich-vu/${item.slug}`), `${viewport.name} repair child service href mismatch`);
    const repairGroupImages = repairGroups.locator('img');
    assert.equal(await repairGroupImages.count(), 3, `${viewport.name} repair child service image count mismatch`);
    for (let i = 0; i < 3; i += 1) {
      await repairGroupImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-subcategories] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    assert.equal(await page.locator('[data-service-projects-heading]').count(), 0, `${viewport.name} repair parent should not render project cards`);
    noAdminOrigin(await page.content(), `${viewport.name}-repair-parent`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-sua-chua-parent.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_REPAIR_PARENT=${viewport.name}:PASS children=3 summaries=3 layout=single-row legacy_media=3`);

    const equipment = repairChildren[0];
    const equipmentResponse = await page.goto(`${front}/dich-vu/${equipment.slug}?_repair_equipment_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(equipmentResponse?.status() === 200, `${viewport.name} repair equipment HTTP ${equipmentResponse?.status()}`);
    assert.equal(clean(await page.locator('h1').first().textContent()), equipment.title, `${viewport.name} repair equipment H1 mismatch`);
    const equipmentDescription = page.locator('[data-service-category-description]');
    assert(await equipmentDescription.isVisible(), `${viewport.name} repair equipment description missing`);
    const equipmentText = clean(await equipmentDescription.textContent());
    for (const phrase of ['(1) Thiết bị tĩnh', '(2) Thiết bị quay', '(3) Thiết bị điện / Tự động hóa']) {
      assert(equipmentText.includes(phrase), `${viewport.name} repair equipment section missing: ${phrase}`);
    }
    const repairCapabilities = page.locator('[data-service-capability-gallery] figure');
    assert.equal(await repairCapabilities.count(), 16, `${viewport.name} repair capability count mismatch`);
    const repairCapabilityImages = repairCapabilities.locator('img');
    assert.equal(await repairCapabilityImages.count(), 16, `${viewport.name} repair capability image count mismatch`);
    for (let i = 0; i < 16; i += 1) {
      await repairCapabilityImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-capability-gallery] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    assert.equal(await page.locator('[data-service-projects-heading]').count(), 0, `${viewport.name} repair equipment should not render project cards`);
    noAdminOrigin(await page.content(), `${viewport.name}-repair-equipment`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-sua-chua-thiet-bi.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_REPAIR_EQUIPMENT=${viewport.name}:PASS capabilities=16`);

    const plant = repairChildren[1];
    const plantResponse = await page.goto(`${front}/dich-vu/${plant.slug}?_repair_plant_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(plantResponse?.status() === 200, `${viewport.name} repair plant HTTP ${plantResponse?.status()}`);
    assert.equal(clean(await page.locator('h1').first().textContent()), plant.title, `${viewport.name} repair plant H1 mismatch`);
    const plantDescription = page.locator('[data-service-category-description]');
    assert(await plantDescription.isVisible(), `${viewport.name} repair plant description missing`);
    assert(clean(await plantDescription.textContent()).includes('Cung cấp quy trình vận hành bảo dưỡng'), `${viewport.name} repair plant intro missing`);
    const plantHeading = page.locator('[data-service-projects-heading]');
    assert(await plantHeading.isVisible(), `${viewport.name} repair plant project heading missing`);
    assert.equal(clean(await plantHeading.textContent()), 'Các dự án đã thực hiện', `${viewport.name} repair plant project heading mismatch`);
    const repairProjectCards = page.locator('[data-service-projects-heading] + div article');
    assert.equal(await repairProjectCards.count(), 8, `${viewport.name} repair project card count mismatch`);
    assert.deepEqual((await repairProjectCards.locator('h2').allTextContents()).map(clean), repairProjectTitles, `${viewport.name} repair project order/title mismatch`);
    const repairProjectImages = repairProjectCards.locator('img');
    assert.equal(await repairProjectImages.count(), 8, `${viewport.name} repair projects should show one representative image each`);
    assert.equal(await repairProjectCards.locator('[data-service-project-gallery]').count(), 0, `${viewport.name} repair project gallery should not render`);
    for (let i = 0; i < 8; i += 1) {
      await repairProjectImages.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-service-projects-heading] + div article img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const repairScopeMetrics = await repairProjectCards.locator('[data-service-project-scope]').evaluateAll((nodes) => nodes.map((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    })));
    assert(repairScopeMetrics.every((item) => item.scrollHeight <= item.clientHeight + 2), `${viewport.name} repair project scope is visually truncated`);
    assert(repairScopeMetrics.every((item) => item.overflow !== 'hidden'), `${viewport.name} repair project scope hides overflow`);
    noAdminOrigin(await page.content(), `${viewport.name}-repair-plant`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-sua-chua-nha-may.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_REPAIR_PLANT=${viewport.name}:PASS projects=8 project_images=8`);

    const other = repairChildren[2];
    const otherResponse = await page.goto(`${front}/dich-vu/${other.slug}?_repair_other_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(otherResponse?.status() === 200, `${viewport.name} repair other HTTP ${otherResponse?.status()}`);
    assert.equal(clean(await page.locator('h1').first().textContent()), other.title, `${viewport.name} repair other H1 mismatch`);
    const otherDescription = page.locator('[data-service-category-description]');
    assert(await otherDescription.isVisible(), `${viewport.name} repair other description missing`);
    const otherText = clean(await otherDescription.textContent());
    assert(otherText.includes('Lắp dựng giàn giáo'), `${viewport.name} repair other scaffolding content missing`);
    assert(otherText.includes('OCIMF'), `${viewport.name} repair other OCIMF content missing`);
    assert.equal(await page.locator('[data-service-projects-heading]').count(), 0, `${viewport.name} repair other should not render project cards`);
    const repairOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(repairOverflow.scroll <= repairOverflow.client + 2, `${viewport.name} repair nested route horizontal overflow`);
    noAdminOrigin(await page.content(), `${viewport.name}-repair-other`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu-sua-chua-khac.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_REPAIR_OTHER=${viewport.name}:PASS`);
    await context.close();
  }

  const requestContext = await browser.newContext();
  try {
    for (const service of services) {
      const response = await requestContext.request.get(`${front}/dich-vu/${service.slug}?_readonly_qa=${Date.now()}`, {
        timeout: 30000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      assert.equal(response.status(), 200, `Category route HTTP ${response.status()} ${service.slug}`);
      const html = await response.text();
      assert(html.includes(service.title), `Category route heading missing ${service.slug}`);
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      assert(titleMatch, `Category route document title missing ${service.slug}`);
      assert.equal(clean(titleMatch[1]), service.title, `Category route document title mismatch ${service.slug}`);
      noAdminOrigin(html, service.slug);
      console.log(`SERVICES_READONLY_QA_CATEGORY=${service.slug}:PASS`);
    }
  } finally {
    await requestContext.close();
  }

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await desktop.newPage();
    await page.goto(`${front}/dich-vu?_menu_readonly_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    const serviceButton = page.locator('#header-navrow button').filter({ hasText: 'Dịch vụ' }).first();
    assert(await serviceButton.isVisible(), 'Desktop Dịch vụ menu button missing');
    await serviceButton.click();

    const expectedMenu = [
      { title: 'Tất cả', href: '/dich-vu' },
      ...services.map((service) => ({ title: service.title, href: `/dich-vu/${service.slug}` })),
    ];
    for (const item of expectedMenu) {
      const link = page.locator('#header-navrow a').filter({ hasText: item.title }).first();
      assert(await link.isVisible(), `Desktop service submenu missing ${item.title}`);
      assert.equal(await link.getAttribute('href'), item.href, `Desktop service submenu href mismatch ${item.title}`);
      assert.notEqual(await link.getAttribute('target'), '_blank', `Desktop service submenu opens new tab ${item.title}`);
    }

    const allLink = page.locator('#header-navrow a').filter({ hasText: 'Tất cả' }).first();
    await Promise.all([
      page.waitForURL((url) => url.origin === frontUrl.origin && url.pathname === '/dich-vu', { timeout: 30000 }),
      allLink.click(),
    ]);
    assert(new URL(page.url()).pathname === '/dich-vu', 'Tất cả did not navigate to /dich-vu in the current tab');
    noAdminOrigin(await page.content(), 'desktop-menu-navigation');
    console.log('SERVICES_READONLY_QA_MENU=PASS');
  } finally {
    await desktop.close();
  }

  console.log('SERVICES_READONLY_QA=PASS categories=4 desktop=PASS mobile=PASS detail_layout=PASS menu=PASS admin_origin=HIDDEN');
} finally {
  await browser.close();
}
