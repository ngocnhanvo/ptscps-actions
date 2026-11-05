import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && user && pass, 'Missing WordPress origin/admin credentials');

const parentSlug = 'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep';
const mediaPrefix = 'ptscps-repair';

const parent = {
  intro: 'Công ty đã đầu tư xây dựng khu nhà xưởng để thực hiện dịch vụ sửa chữa bảo dưỡng trên diện tích 5000m2 nằm trong khu vực Cảng hạ lưu PTSC, đồng thời cũng đã đầu tư đầy đủ trang thiết bị nhằm phục vụ công tác bảo dưỡng, sửa chữa trên các tàu FPSO/FSO và thực hiện các dịch vụ khác cho khách hàng. Công ty đã được cấp chứng chỉ ASME (American Society of Mechanical Engineers) về thiết kế, sản xuất chế tạo và sửa chữa nồi hơi và bình chịu áp lực.',
  image: ['workshop', 'Xưởng cơ khí bảo dưỡng PTSC', 'https://ptscps.com.vn/wp-content/uploads/2019/10/xuongckbd.jpg'],
};

const children = [
  {
    title: 'Dịch vụ Bảo dưỡng, sửa chữa thiết bị tĩnh, thiết bị quay, thiết bị điện và tự động hóa',
    slug: 'dich-vu-bao-duong-sua-chua-thiet-bi-tinh-thiet-bi-quay-thiet-bi-dien-va-tu-dong-hoa',
    thumbnail: ['static-valve', 'Bảo dưỡng sửa chữa van', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Preparation-for-Lapping-Ball-Valve.jpg'],
  },
  {
    title: 'Vận hành và bảo dưỡng sửa chữa các nhà máy, các công trình công nghiệp',
    slug: 'van-hanh-va-bao-duong-sua-chua-cac-nha-may-cac-cong-trinh-cong-nghiep',
    thumbnail: ['plant-project', 'Bảo dưỡng sửa chữa tại nhà máy', 'https://ptscps.com.vn/wp-content/uploads/2019/12/binhson.png'],
  },
  {
    title: 'Các dịch vụ khác',
    slug: 'cac-dich-vu-khac',
    thumbnail: ['other-services', 'Dịch vụ sửa chữa bảo dưỡng khác', 'https://ptscps.com.vn/wp-content/uploads/2019/10/xuongckbd.jpg'],
  },
];

const child1Media = [
  ['static-valve', 'Preparation for Lapping Ball Valve 30”', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Preparation-for-Lapping-Ball-Valve.jpg'],
  ['static-cage', 'To fix the scratch of Cage', 'https://ptscps.com.vn/wp-content/uploads/2019/12/To-fix-the-scratch-of-Cage.jpg'],
  ['heat-exchanger-1', 'Bảo dưỡng thiết bị trao đổi nhiệt', 'https://ptscps.com.vn/wp-content/uploads/2019/12/heat-exchanger-1-390x220.jpg'],
  ['heat-exchanger-2', 'Vệ sinh thiết bị trao đổi nhiệt', 'https://ptscps.com.vn/wp-content/uploads/2019/12/heat-exchanger-2-390x220.jpg'],
  ['tank-vessel-1', 'Bảo dưỡng két và bình áp lực', 'https://ptscps.com.vn/wp-content/uploads/2019/12/tank-and-vessel-1.jpg-390x220.png'],
  ['tank-vessel-2', 'Thiết bị két và bình áp lực', 'https://ptscps.com.vn/wp-content/uploads/2019/12/tank-and-vessel-390x220.jpg'],
  ['phu-my-1', 'Revamping Steam Turbines package for Phu My Fertilizer 1', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Phu-my-150x150.jpg'],
  ['phu-my-2', 'Revamping Steam Turbines package for Phu My Fertilizer 2', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Phu-my-1-150x150.jpg'],
  ['phu-my-3', 'Revamping Steam Turbines package for Phu My Fertilizer 3', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Phu-my-2-150x150.jpg'],
  ['phu-my-4', 'Revamping Steam Turbines package for Phu My Fertilizer 4', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Phu-my-3-150x150.jpg'],
  ['compressor-1', 'Throw #2 piston rod run out check after the machine stopped', 'https://ptscps.com.vn/wp-content/uploads/2019/12/over.jpg'],
  ['compressor-2', 'Throw #2 VVCP cover and piston removed', 'https://ptscps.com.vn/wp-content/uploads/2019/12/overhaul.jpg'],
  ['compressor-3', 'Changing of Crosshead shims', 'https://ptscps.com.vn/wp-content/uploads/2019/12/overhaul1.jpg'],
  ['compressor-4', 'Laser alignment for Cylinder', 'https://ptscps.com.vn/wp-content/uploads/2019/12/overhaul2-300x225.jpg'],
  ['electrical-1', 'Kiểm tra thiết bị điện', 'https://ptscps.com.vn/wp-content/uploads/2019/12/TDH-1.png'],
  ['electrical-2', 'Bảo dưỡng thiết bị điện và tự động hóa', 'https://ptscps.com.vn/wp-content/uploads/2019/12/TDH1-1.png'],
];

const projects = [
  {
    title: 'Dự án bảo dưỡng sửa chữa van trong đợt bảo dưỡng tổng thể lần 4 – Nhà máy lọc dầu Dung Quất',
    slug: 'bao-duong-sua-chua-van-dung-quat',
    scope: 'Cung cấp quy trình, nhân lực, vật tư và thiết bị bảo dưỡng và sửa chữa van an toàn, van điều khiển và van tay (tổng số lượng khoảng 1400 van các loại) tại Nhà máy Lọc dầu Dung Quất.',
    images: [['dung-quat-1', 'Bảo dưỡng sửa chữa van tại Nhà máy lọc dầu Dung Quất', 'https://ptscps.com.vn/wp-content/uploads/2019/12/binhson.png']],
  },
  {
    title: 'Dự án cung cấp quy trình bảo dưỡng, bảo dưỡng hàng ngày, bảo dưỡng chiến dịch cho trạm nạp liệu ngầm sân bay Tân Sơn Nhất',
    slug: 'bao-duong-tram-nap-lieu-ngam-tan-son-nhat',
    scope: 'Cung cấp quy trình, phần mềm (AMOS), nhân lực, vật tư, thiết bị để bảo dưỡng hệ thống các thiết bị (tĩnh, quay, điện điều khiển), bao gồm bảo dưỡng hàng ngày, bảo dưỡng định kỳ và bảo dưỡng bất thường.',
    images: [
      ['tan-son-nhat-1', 'Thiết bị trạm nạp liệu ngầm sân bay Tân Sơn Nhất', 'https://ptscps.com.vn/wp-content/uploads/2019/12/tsn.jpg'],
      ['tan-son-nhat-2', 'Bảo dưỡng thiết bị trạm nạp liệu Tân Sơn Nhất', 'https://ptscps.com.vn/wp-content/uploads/2019/12/tsn1.jpg'],
      ['tan-son-nhat-3', 'Hiệu chỉnh thiết bị trạm nạp liệu Tân Sơn Nhất', 'https://ptscps.com.vn/wp-content/uploads/2019/12/tsn2.jpg'],
    ],
  },
  {
    title: 'Dự án bảo dưỡng sửa chữa và cung cấp vật tư cho toàn bộ van đường ống cho nhà máy Lọc hóa dầu Nghi Sơn',
    slug: 'bao-duong-van-duong-ong-nghi-son',
    scope: 'Hợp đồng khung cung cấp nhân sự, vật tư, thiết bị bảo dưỡng toàn bộ các van đường ống trong nhà máy Lọc hóa dầu Nghi Sơn.',
    images: [
      ['nghi-son-valve-1', 'Bảo dưỡng van đường ống Nghi Sơn 1', 'https://ptscps.com.vn/wp-content/uploads/2019/12/nghison-375x405.jpg'],
      ['nghi-son-valve-2', 'Bảo dưỡng van đường ống Nghi Sơn 2', 'https://ptscps.com.vn/wp-content/uploads/2019/12/nghison1-377x405.jpg'],
      ['nghi-son-valve-3', 'Bảo dưỡng van đường ống Nghi Sơn 3', 'https://ptscps.com.vn/wp-content/uploads/2019/12/nghison2-780x405.jpg'],
    ],
  },
  {
    title: 'Dự án kiểm tra, hiệu chỉnh và sửa chữa van an toàn thuộc Gói 1 – PSV dự án DCSM (Turnaround) cho nhà máy Lọc hóa dầu Nghi Sơn',
    slug: 'psv-dcsm-nghi-son',
    scope: 'Cung cấp quy trình, nhân sự, vật tư, thiết bị để kiểm tra, hiệu chỉnh và sửa chữa khoảng 800 van an toàn của Nhà máy lọc hóa dầu Nghi Sơn trong chiến dịch DCSM.',
    images: [
      ['nghi-son-psv-1', 'DCSM Nghi Sơn 1', 'https://ptscps.com.vn/wp-content/uploads/2019/12/ns-780x405.png'],
      ['nghi-son-psv-2', 'DCSM Nghi Sơn 2', 'https://ptscps.com.vn/wp-content/uploads/2019/12/ns1-780x405.png'],
      ['nghi-son-psv-3', 'DCSM Nghi Sơn 3', 'https://ptscps.com.vn/wp-content/uploads/2019/12/ns2-780x405.png'],
    ],
  },
  {
    title: 'Thực hiện dịch vụ sửa chữa turbine hơi cho Nhà máy đạm Phú Mỹ',
    slug: 'sua-chua-turbine-hoi-dam-phu-my',
    scope: 'Bảo dưỡng Turbine – Dự án nâng cấp mở rộng phân xưởng NH3 thuộc nhà máy Đạm Phú Mỹ.',
    images: [
      ['phu-my-turbine-1', 'Sửa chữa turbine hơi Nhà máy đạm Phú Mỹ 1', 'https://ptscps.com.vn/wp-content/uploads/2020/05/Th%E1%BB%B1c-hi%E1%BB%87n-d%E1%BB%8Bch-v%E1%BB%A5-s%E1%BB%ADa-ch%E1%BB%AFa-turbine-h%C6%A1i-cho-Nh%C3%A0-m%C3%A1y-%C4%91%E1%BA%A1m-Ph%C3%BA-M%E1%BB%B9-01.jpg'],
      ['phu-my-turbine-2', 'Sửa chữa turbine hơi Nhà máy đạm Phú Mỹ 2', 'https://ptscps.com.vn/wp-content/uploads/2020/05/Th%E1%BB%B1c-hi%E1%BB%87n-d%E1%BB%8Bch-v%E1%BB%A5-s%E1%BB%ADa-ch%E1%BB%AFa-turbine-h%C6%A1i-cho-Nh%C3%A0-m%C3%A1y-%C4%91%E1%BA%A1m-Ph%C3%BA-M%E1%BB%B9-02.jpg'],
      ['phu-my-turbine-3', 'Sửa chữa turbine hơi Nhà máy đạm Phú Mỹ 3', 'https://ptscps.com.vn/wp-content/uploads/2020/05/Th%E1%BB%B1c-hi%E1%BB%87n-d%E1%BB%8Bch-v%E1%BB%A5-s%E1%BB%ADa-ch%E1%BB%AFa-turbine-h%C6%A1i-cho-Nh%C3%A0-m%C3%A1y-%C4%91%E1%BA%A1m-Ph%C3%BA-M%E1%BB%B9-04.jpg'],
      ['phu-my-turbine-4', 'Sửa chữa turbine hơi Nhà máy đạm Phú Mỹ 4', 'https://ptscps.com.vn/wp-content/uploads/2020/05/Th%E1%BB%B1c-hi%E1%BB%87n-d%E1%BB%8Bch-v%E1%BB%A5-s%E1%BB%ADa-ch%E1%BB%AFa-turbine-h%C6%A1i-cho-Nh%C3%A0-m%C3%A1y-%C4%91%E1%BA%A1m-Ph%C3%BA-M%E1%BB%B9-03-1024x761.jpg'],
    ],
  },
  {
    title: 'Dự án bảo dưỡng, sửa chữa van tại Nhà máy lọc hóa dầu Bình Sơn',
    slug: 'bao-duong-sua-chua-van-binh-son',
    scope: 'Bảo dưỡng, sửa chữa van tại Nhà máy Lọc hóa dầu Bình Sơn trong đợt TA3-2017 (bao gồm 1.449 van các loại).',
    images: [
      ['binh-son-1', 'Bảo dưỡng sửa chữa van Bình Sơn 1', 'https://ptscps.com.vn/wp-content/uploads/2020/05/D%E1%BB%B1-%C3%A1n-b%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-van-t%E1%BA%A1i-Nh%C3%A0-m%C3%A1y-l%E1%BB%8Dc-h%C3%B3a-d%E1%BA%A7u-B%C3%ACnh-S%C6%A1n-01-1024x768.jpg'],
      ['binh-son-2', 'Bảo dưỡng sửa chữa van Bình Sơn 2', 'https://ptscps.com.vn/wp-content/uploads/2020/05/D%E1%BB%B1-%C3%A1n-b%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-van-t%E1%BA%A1i-Nh%C3%A0-m%C3%A1y-l%E1%BB%8Dc-h%C3%B3a-d%E1%BA%A7u-B%C3%ACnh-S%C6%A1n-02-1024x768.jpg'],
    ],
  },
  {
    title: 'Dự án sửa chữa tank két trên tàu FPSO RUBY II cho khách hàng VOFT',
    slug: 'sua-chua-tank-ket-fpso-ruby-ii',
    scope: 'Thực hiện công tác sửa chữa tank két (17 tank & 03 khu vực: Pump room; Engine room; Upper deck) – Dự án Life extension tàu FPSO Ruby II cho VOFT.',
    images: [
      ['ruby-tank-1', 'Sửa chữa tank két FPSO RUBY II 1', 'https://ptscps.com.vn/wp-content/uploads/2020/05/D%E1%BB%B1-%C3%A1n-s%E1%BB%ADa-ch%E1%BB%AFa-tank-k%C3%A9t-tr%C3%AAn-t%C3%A0u-FPSO-RUBY-II-cho-kh%C3%A1ch-h%C3%A0ng-VOFT-01.jpg'],
      ['ruby-tank-2', 'Sửa chữa tank két FPSO RUBY II 2', 'https://ptscps.com.vn/wp-content/uploads/2020/05/D%E1%BB%B1-%C3%A1n-s%E1%BB%ADa-ch%E1%BB%AFa-tank-k%C3%A9t-tr%C3%AAn-t%C3%A0u-FPSO-RUBY-II-cho-kh%C3%A1ch-h%C3%A0ng-VOFT-02.jpg'],
      ['ruby-tank-3', 'Sửa chữa tank két FPSO RUBY II 3', 'https://ptscps.com.vn/wp-content/uploads/2020/05/D%E1%BB%B1-%C3%A1n-s%E1%BB%ADa-ch%E1%BB%AFa-tank-k%C3%A9t-tr%C3%AAn-t%C3%A0u-FPSO-RUBY-II-cho-kh%C3%A1ch-h%C3%A0ng-VOFT-03.png'],
      ['ruby-tank-4', 'Sửa chữa tank két FPSO RUBY II 4', 'https://ptscps.com.vn/wp-content/uploads/elementor/thumbs/D%E1%BB%B1-%C3%A1n-s%E1%BB%ADa-ch%E1%BB%AFa-tank-k%C3%A9t-tr%C3%AAn-t%C3%A0u-FPSO-RUBY-II-cho-kh%C3%A1ch-h%C3%A0ng-VOFT-04-qwzd6ndhntmnn3sff6mbaumdmpxiujro69w9dq4hn8.png'],
    ],
  },
  {
    title: 'Bảo dưỡng, sửa chữa ống Floating Hose trên tàu FSO MV17 cho khách hàng MODEC',
    slug: 'bao-duong-floating-hose-fso-mv17',
    scope: 'Bảo dưỡng, test ống dầu trên FSO MV17 theo tiêu chuẩn OCIMF.',
    images: [
      ['mv17-hose-1', 'Bảo dưỡng Floating Hose FSO MV17 1', 'https://ptscps.com.vn/wp-content/uploads/2020/05/B%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-%E1%BB%91ng-Floating-Hose-tr%C3%AAn-t%C3%A0u-FSO-MV17-cho-kh%C3%A1ch-h%C3%A0ng-MODEC-01.jpg'],
      ['mv17-hose-2', 'Bảo dưỡng Floating Hose FSO MV17 2', 'https://ptscps.com.vn/wp-content/uploads/2020/05/B%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-%E1%BB%91ng-Floating-Hose-tr%C3%AAn-t%C3%A0u-FSO-MV17-cho-kh%C3%A1ch-h%C3%A0ng-MODEC-02.jpg'],
      ['mv17-hose-3', 'Bảo dưỡng Floating Hose FSO MV17 3', 'https://ptscps.com.vn/wp-content/uploads/2020/05/B%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-%E1%BB%91ng-Floating-Hose-tr%C3%AAn-t%C3%A0u-FSO-MV17-cho-kh%C3%A1ch-h%C3%A0ng-MODEC-03.jpg'],
      ['mv17-hose-4', 'Bảo dưỡng Floating Hose FSO MV17 4', 'https://ptscps.com.vn/wp-content/uploads/2020/05/B%E1%BA%A3o-d%C6%B0%E1%BB%A1ng-s%E1%BB%ADa-ch%E1%BB%AFa-%E1%BB%91ng-Floating-Hose-tr%C3%AAn-t%C3%A0u-FSO-MV17-cho-kh%C3%A1ch-h%C3%A0ng-MODEC-04.jpg'],
    ],
  },
];

const child1Text = `<h2>(1) Thiết bị tĩnh</h2><h3>Bảo dưỡng/sửa chữa van các loại</h3><p>Cung cấp dịch vụ kiểm tra, đại tu, sửa chữa, hiệu chỉnh bao gồm cung cấp và chế tạo vật tư (spare part) cho van an toàn (pressure safety valve), van điều khiển (control valve) và van tay (manual valve).</p><h3>Bảo dưỡng sửa chữa các thiết bị trao đổi nhiệt (Heat exchanger)</h3><ul><li>Cleaning in place (CIP) – Chemical cleaning</li><li>Shell and tube internal cleaning (high pressure water jetting)</li><li>Tube leaking test and rectification</li><li>Tube/tube bundle repair and replacement</li><li>Clean and anti-corrosion inside the Shell</li><li>Re-assemble &amp; carry out pressure testing</li></ul><h3>Bảo dưỡng sửa chữa các két, bình áp lực (tank and vessel)</h3><ul><li>Hot bolting</li><li>Cleaning/chemical cleaning for the shell, trays, internals / replace internals and other surfaces for visual inspection</li><li>NDT (MPI/UT/PT/RT)</li><li>Inspection by API 510 Inspector</li><li>Corrosion control/Insulation repair</li><li>Defect repair</li><li>Hydro test</li></ul><h2>(2) Thiết bị quay</h2><p>Cung cấp dịch vụ bảo dưỡng, sửa chữa và nâng cấp các thiết bị quay bao gồm Pump (Centrifugal, Screw and Reciprocating pumps), Turbines (Gas turbine, Steam turbine), Compressors (Centrifugal and Reciprocating compressors), Diesel Engines, Boilers and other Rotating equipment.</p><h3>Revamping Steam Turbines package for Phu My Fertilizer</h3><h3>Reciprocating Compressor Overhaul</h3><h2>(3) Thiết bị điện / Tự động hóa</h2><ul><li>Bảo dưỡng, sửa chữa, lắp đặt động cơ điện có công suất lên đến 300KW.</li><li>Bảo dưỡng động cơ điện AC/DC.</li><li>Kiểm tra/Bảo dưỡng các hệ thống điện/kiểm tra bình acqui trên các tàu FPSO/FSO và cho các khách hàng dầu khí.</li><li>Test định kỳ các thiết bị điện.</li><li>Dịch vụ kiểm tra hình ảnh nhiệt cho các thiết bị điện (Dịch vụ CBM).</li></ul>`;
const child2Text = `<ul><li>Cung cấp quy trình vận hành bảo dưỡng các hệ thống thiết bị nhà máy, công trình công nghiệp.</li><li>Cung cấp nhân sự vận hành, bảo dưỡng sửa chữa lớn các hệ thống thiết bị cho các nhà máy, công trình công nghiệp.</li></ul><p><strong>Năng lực tiêu biểu:</strong> Cung cấp dịch vụ sửa chữa turbine hơi cho Nhà máy đạm Phú Mỹ; đại tu máy nén pittông.</p>`;
const child3Text = `<ul><li>Lắp dựng giàn giáo phục vụ việc bảo dưỡng sửa chữa/chống ăn mòn trên các tàu FPSO/FSO (năng lực trên 1000m3/lần thực hiện).</li><li>Thực hiện việc chống ăn mòn trên các tàu FPSO/FSO (năng lực thực hiện đến 1200 m2/năm).</li><li>Kiểm tra, sửa chữa, test theo tiêu chuẩn OCIMF (Oil Companies International Marine Forum), lắp đặt ống xuất dầu (floating hose) cho các tàu FPSO/FSO.</li><li>Kiểm tra, cân tâm cho các thiết bị quay tại xưởng và trên các tàu FPSO/FSO.</li><li>Đo UTM cho đường ống công nghệ trên các tàu. Đánh giá &amp; nhận xét về độ giảm chiều dày &amp; lifetime của đường ống.</li><li>Doa, mạ &amp; phun phủ phục hồi các chi tiết/thiết bị cơ khí.</li></ul>`;

const clean = (value) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;|&#0?38;|&#x26;/gi, '&').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/\s+/g, ' ').trim();
const report = (key, value) => console.log(`REPAIR_PARITY_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

async function login() {
  await page.goto(`${wp}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#wp-submit').click()]);
  if (new URL(page.url()).searchParams.get('action') === 'confirm_admin_email') {
    const skip = page.locator('a.skip-confirmation-button').first();
    const confirm = page.locator('#correct-admin-email').first();
    if (await skip.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), skip.click()]);
    else if (await confirm.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), confirm.click()]);
  } else if (!/\/wp-admin\//.test(page.url())) await page.waitForURL(/\/wp-admin\//, { timeout: 50000 });
  assert(new URL(page.url()).origin === wp && /\/wp-admin\//.test(page.url()), 'WordPress admin login failed');
  report('ADMIN_AUTH', 'PASS');
}

async function restNonce() {
  for (const path of ['/wp-admin/nav-menus.php?esc_full_admin=1', '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1']) {
    await page.goto(`${wp}${path}`, { waitUntil: 'domcontentloaded', timeout: 50000 });
    const nonce = await page.evaluate(() => String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  throw Error('WordPress REST nonce unavailable');
}

async function jsonRequest(method, path, nonce, data) {
  const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Cache-Control': 'no-cache' }, timeout: 60000 };
  if (data !== undefined) opts.data = data;
  const res = await page.request.fetch(`${wp}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function findCategory(nonce, slug) {
  const { res, body } = await jsonRequest('GET', `/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&slug=${encodeURIComponent(slug)}&per_page=20`, nonce);
  assert(res.ok(), `Category lookup HTTP ${res.status()} ${slug}`);
  assert(Array.isArray(body) && body.length <= 1, `Duplicate category ${slug}`);
  return body[0] || null;
}

async function listCategories(nonce) {
  const { res, body } = await jsonRequest('GET', '/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&per_page=100&_fields=id,name,slug,parent,description', nonce);
  assert(res.ok(), `Category list HTTP ${res.status()}`);
  return Array.isArray(body) ? body : [];
}

async function ensureChildCategory(nonce, parentId, spec) {
  let item = await findCategory(nonce, spec.slug);
  if (!item) {
    const created = await jsonRequest('POST', '/wp-json/wp/v2/product_cat', nonce, { name: spec.title, slug: spec.slug, parent: Number(parentId) });
    assert(created.res.ok() && Number(created.body?.id) > 0, `Category create failed ${spec.slug}`);
    item = created.body;
    report('CATEGORY', { slug: spec.slug, id: item.id, state: 'CREATED_VERIFIED' });
  } else {
    assert(Number(item.parent || 0) === Number(parentId), `Category parent mismatch ${spec.slug}`);
    if (clean(item.name) !== clean(spec.title)) {
      const updated = await jsonRequest('POST', `/wp-json/wp/v2/product_cat/${item.id}`, nonce, { name: spec.title, parent: Number(parentId) });
      assert(updated.res.ok(), `Category name update failed ${spec.slug}`);
      item = updated.body;
      report('CATEGORY', { slug: spec.slug, id: item.id, state: 'UPDATED_VERIFIED' });
    } else report('CATEGORY', { slug: spec.slug, id: item.id, state: 'ALREADY_PRESENT_SKIP_WRITE' });
  }
  return item;
}

async function categoryFeed() {
  const res = await page.request.get(`${wp}/wp-json/astro/v1/get-product-categories?_repair=${Date.now()}`, { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } });
  assert(res.ok(), `Product category feed HTTP ${res.status()}`);
  return await res.json();
}

async function ensureCategoryOrder(parentId, childRows) {
  const expected = children.map((x) => x.slug);
  const read = async () => (await categoryFeed()).filter((x) => Number(x.parent || 0) === Number(parentId)).map((x) => x.slug).filter((x) => expected.includes(x));
  if (JSON.stringify(await read()) === JSON.stringify(expected)) { report('CATEGORY_ORDER', 'ALREADY_CORRECT_SKIP_WRITE'); return false; }
  await page.goto(`${wp}/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  const security = await page.evaluate(() => String(globalThis.woocommerce_term_ordering_params?.nonce || '').trim());
  assert(security, 'WooCommerce term ordering nonce missing');
  const bySlug = Object.fromEntries(childRows.map((x) => [x.slug, x]));
  const reverse = [...children].reverse();
  for (let i = 0; i < reverse.length; i++) {
    const current = reverse[i], next = i === 0 ? null : reverse[i - 1];
    const res = await page.request.post(`${wp}/wp-admin/admin-ajax.php`, { form: { action:'woocommerce_term_ordering', security, id:String(bySlug[current.slug].id), nextid:next ? String(bySlug[next.slug].id) : '', thetaxonomy:'product_cat' }, timeout:30000 });
    assert(res.ok(), `Term ordering failed ${current.slug}`);
  }
  for (let i=0;i<8;i++){await sleep(500); if(JSON.stringify(await read())===JSON.stringify(expected)){report('CATEGORY_ORDER',{status:'PASS',slugs:expected});return true;}}
  throw Error(`Category order mismatch ${JSON.stringify(await read())}`);
}

function extensionFrom(url, contentType='') {
  const raw = new URL(url).pathname.split('.').pop()?.toLowerCase() || '';
  if (/^(png|jpe?g|webp|gif)$/.test(raw)) return raw === 'jpeg' ? 'jpg' : raw;
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

async function findMedia(nonce, slug) {
  const { res, body } = await jsonRequest('GET', `/wp-json/wp/v2/media?context=edit&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,source_url,alt_text,title`, nonce);
  assert(res.ok(), `Media lookup HTTP ${res.status()} ${slug}`);
  assert(Array.isArray(body) && body.length <= 1, `Duplicate media ${slug}`);
  return body[0] || null;
}

async function ensureMedia(nonce, key, title, sourceUrl) {
  const slug = `${mediaPrefix}-${key}`;
  let media = await findMedia(nonce, slug);
  if (media) { report('MEDIA', { key, id: media.id, state: 'ALREADY_PRESENT_SKIP_WRITE' }); return media; }
  const source = await fetch(sourceUrl, { headers: { 'User-Agent':'PTSCPS migration' } });
  assert(source.ok, `Legacy image HTTP ${source.status} ${key}`);
  const bytes = Buffer.from(await source.arrayBuffer());
  assert(bytes.length > 1500, `Legacy image too small ${key}`);
  const contentType = source.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const file = `${slug}.${extensionFrom(sourceUrl, contentType)}`;
  const upload = await page.request.post(`${wp}/wp-json/wp/v2/media`, { headers: { 'X-WP-Nonce':nonce, 'Content-Type':contentType, 'Content-Disposition':`attachment; filename="${file}"` }, data:bytes, timeout:60000 });
  const body = await upload.json().catch(()=>({}));
  assert(upload.ok() && Number(body?.id)>0, `Media upload failed ${key} HTTP ${upload.status()}`);
  const meta = await jsonRequest('POST', `/wp-json/wp/v2/media/${body.id}`, nonce, { alt_text:title, title, caption:'' });
  assert(meta.res.ok(), `Media metadata failed ${key}`);
  media = await findMedia(nonce, slug);
  assert(media && Number(media.id)===Number(body.id), `Media readback failed ${key}`);
  report('MEDIA', { key, id:media.id, state:'CREATED_VERIFIED' });
  return media;
}

function relativeMediaPath(media) {
  const u = new URL(String(media?.source_url || ''), wp);
  return u.origin === new URL(wp).origin ? `${u.pathname}${u.search}` : u.href;
}

async function setCategoryThumbnail(termId, mediaId, slug) {
  const feed = await categoryFeed();
  const current = feed.find((x)=>Number(x.id)===Number(termId));
  const targetMedia = await page.request.get(`${wp}/wp-json/wp/v2/media/${mediaId}?_fields=source_url`, { timeout:30000 }).then((r)=>r.json());
  const expectedPath = new URL(targetMedia.source_url, wp).pathname;
  if (String(current?.image?.url || '').includes(expectedPath.split('/').pop().split('.')[0])) { report('THUMBNAIL',{slug,state:'ALREADY_PRESENT_SKIP_WRITE'}); return false; }
  await page.goto(`${wp}/wp-admin/term.php?taxonomy=product_cat&tag_ID=${termId}&post_type=product&esc_full_admin=1`, {waitUntil:'domcontentloaded',timeout:50000});
  const input=page.locator('#product_cat_thumbnail_id'); assert(await input.count()===1,`Thumbnail field missing ${slug}`);
  await input.evaluate((el,id)=>{el.value=String(id);el.dispatchEvent(new Event('change',{bubbles:true}));},mediaId);
  const form=page.locator('form#edittag').first(); assert(await form.count()===1,`Term form missing ${slug}`);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),form.evaluate(el=>el.requestSubmit())]);
  for(let i=0;i<8;i++){await sleep(500);const item=(await categoryFeed()).find(x=>Number(x.id)===Number(termId));if(String(item?.image?.url||'').includes(expectedPath.split('/').pop().split('.')[0])){report('THUMBNAIL',{slug,state:'UPDATED_VERIFIED'});return true;}}
  throw Error(`Thumbnail readback failed ${slug}`);
}

async function ensureDescription(nonce, category, html, key) {
  const current = String(category?.description?.raw ?? category?.description ?? '');
  if (clean(current) === clean(html)) { report('DESCRIPTION',{key,state:'ALREADY_CORRECT_SKIP_WRITE'}); return false; }
  const {res,body}=await jsonRequest('POST',`/wp-json/wp/v2/product_cat/${category.id}`,nonce,{description:html});
  assert(res.ok(),`Description update failed ${key}`);
  assert(clean(body.description?.raw ?? body.description ?? '')===clean(html),`Description readback mismatch ${key}`);
  report('DESCRIPTION',{key,state:'UPDATED_VERIFIED'}); return true;
}

async function productBySlug(nonce, slug) {
  const {res,body}=await jsonRequest('GET',`/wp-json/wp/v2/product?context=edit&status=publish,draft,pending,private&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,status,title,acf,content,excerpt,featured_media,product_categories,menu_order`,nonce);
  assert(res.ok(),`Product lookup failed ${slug}`); assert(Array.isArray(body)&&body.length<=1,`Duplicate product ${slug}`); return body[0]||null;
}
async function readGalleryIds(id){await page.goto(`${wp}/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`,{waitUntil:'domcontentloaded',timeout:50000});const input=page.locator('#product_image_gallery, input[name="product_image_gallery"]').first();assert(await input.count()===1,`Gallery input missing ${id}`);return (await input.inputValue()).split(',').map(x=>Number(x.trim())).filter(x=>x>0);}
async function setProductAdminFields(id,galleryIds){await page.goto(`${wp}/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`,{waitUntil:'domcontentloaded',timeout:50000});const row=page.locator('[data-name="product_lang"]').first();assert(await row.count()===1,`product_lang missing ${id}`);const select=row.locator('select').first();if(await select.count())await select.selectOption('vi');else await row.locator('input[type="text"],input:not([type])').first().fill('vi');const gi=page.locator('#product_image_gallery, input[name="product_image_gallery"]').first();await gi.evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('change',{bubbles:true}));},galleryIds.join(','));const publish=page.locator('#publish');assert(await publish.count(),`Publish missing ${id}`);await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),publish.click()]);assert.deepEqual(await readGalleryIds(id),galleryIds,`Gallery readback mismatch ${id}`);}
async function wcProduct(nonce,id,data){const {res,body}=await jsonRequest(data===undefined?'GET':'POST',`/wp-json/wc/v3/products/${id}${data===undefined?'?context=edit':''}`,nonce,data);assert(res.ok(),`Woo REST failed ${id}`);return body;}

async function ensureProject(nonce, category, project, order) {
  const media=[]; for(const [key,alt,url] of project.images) media.push(await ensureMedia(nonce,key,alt,url));
  const featured=Number(media[0].id), gallery=media.slice(1).map(x=>Number(x.id));
  const content=`<p><strong>Phạm vi công việc:</strong> ${project.scope}</p>`; const excerpt=`<p>${project.scope}</p>`;
  let p=await productBySlug(nonce,project.slug); let existingGallery=p?await readGalleryIds(Number(p.id)):[];
  const cats=(p?.product_categories||[]).map(x=>Number(x.id)); const lang=p?.acf?.product_lang?.value??p?.acf?.product_lang;
  const correct=p&&clean(p.title?.raw??p.title?.rendered)===project.title&&clean(p.content?.raw??p.content?.rendered)===clean(content)&&clean(p.excerpt?.raw??p.excerpt?.rendered)===clean(excerpt)&&Number(p.featured_media)===featured&&cats.includes(Number(category.id))&&lang==='vi'&&JSON.stringify(existingGallery)===JSON.stringify(gallery)&&Number(p.menu_order||0)===order;
  if(correct){report('PRODUCT',{slug:project.slug,id:p.id,state:'ALREADY_CORRECT_SKIP_WRITE',gallery:gallery.length,order});return false;}
  const payload={title:project.title,slug:project.slug,status:'publish',content,excerpt,featured_media:featured,product_cat:[Number(category.id)]}; let state='UPDATED_VERIFIED';
  if(p){const u=await jsonRequest('POST',`/wp-json/wp/v2/product/${p.id}`,nonce,payload);assert(u.res.ok(),`Product update failed ${project.slug}`);}else{const c=await jsonRequest('POST','/wp-json/wp/v2/product',nonce,payload);assert(c.res.ok()&&c.body.id,`Product create failed ${project.slug}`);p=c.body;state='CREATED_VERIFIED';}
  await setProductAdminFields(Number(p.id),gallery); await wcProduct(nonce,Number(p.id),{menu_order:order});
  const rb=await productBySlug(nonce,project.slug);assert(rb&&rb.status==='publish',`Product readback missing ${project.slug}`);assert(Number(rb.menu_order||0)===order,`Product order mismatch ${project.slug}`);assert((rb.product_categories||[]).some(x=>Number(x.id)===Number(category.id)),`Product category mismatch ${project.slug}`);assert((rb.acf?.product_lang?.value??rb.acf?.product_lang)==='vi',`Product lang mismatch ${project.slug}`);assert.deepEqual(await readGalleryIds(Number(rb.id)),gallery,`Final gallery mismatch ${project.slug}`);report('PRODUCT',{slug:project.slug,id:rb.id,state,gallery:gallery.length,order});return true;
}

function descriptionWithMedia(text, media, captions) {
  const figures=media.map((m,i)=>`<figure><img src="${relativeMediaPath(m)}" alt="${captions[i]||''}" /><figcaption>${captions[i]||''}</figcaption></figure>`).join('');
  return `${text}${figures}`;
}

try {
  await login(); const nonce=await restNonce();
  const parentCategory=await findCategory(nonce,parentSlug); assert(parentCategory,`Parent category missing ${parentSlug}`);
  const workshop=await ensureMedia(nonce,...parent.image);
  const parentHtml=`<p>${parent.intro}</p><figure><img src="${relativeMediaPath(workshop)}" alt="Xưởng cơ khí bảo dưỡng PTSC" /></figure><p><strong>Các dịch vụ sửa chữa bảo dưỡng được Công ty thực hiện gồm ba nhóm dịch vụ chính dưới đây.</strong></p>`;
  await ensureDescription(nonce,parentCategory,parentHtml,'parent');
  const childRows=[]; for(const spec of children) childRows.push(await ensureChildCategory(nonce,parentCategory.id,spec));
  await ensureCategoryOrder(parentCategory.id,childRows);

  const child1=childRows[0], child2=childRows[1], child3=childRows[2];
  const child1Thumb=await ensureMedia(nonce,...children[0].thumbnail); await setCategoryThumbnail(child1.id,child1Thumb.id,child1.slug);
  const child2Thumb=await ensureMedia(nonce,...children[1].thumbnail); await setCategoryThumbnail(child2.id,child2Thumb.id,child2.slug);
  await setCategoryThumbnail(child3.id,workshop.id,child3.slug);

  const child1Images=[]; for(const spec of child1Media) child1Images.push(await ensureMedia(nonce,...spec));
  await ensureDescription(nonce,child1,descriptionWithMedia(child1Text,child1Images,child1Media.map(x=>x[1])),'equipment');
  await ensureDescription(nonce,child2,child2Text,'plants');
  await ensureDescription(nonce,child3,child3Text,'other');

  let changed=0; for(let i=0;i<projects.length;i++) if(await ensureProject(nonce,child2,projects[i],i+1)) changed++;
  report('RESULT',{status:'PASS',categories:3,equipmentImages:child1Images.length,projects:projects.length,projectImages:projects.reduce((n,p)=>n+p.images.length,0),changedProducts:changed});
} finally { await browser.close(); }
