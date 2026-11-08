# ChatGPT — latest response

- Date: 2026-11-08, Asia/Ho_Chi_Minh
- Project: ptscps.com.vn
- Repository: ngocnhanvo/ptscps-actions
- Branch: main
- Status: PASS / deployed / visual QA PASS

## Response

## Hoàn tất `home_05` lấy tin tức theo API tùy chỉnh của ESC Table

- Bảng ESC Table `home_05` và `home_05_en` đã chọn **API tùy chỉnh**, nguồn lưu trong `meta.api` WordPress; native Save và REST readback PASS, giữ nguyên các hàng cũ.
- API VI: `/wp-json/wp/v2/posts?cat=tin-tuc&lang=vi&_embed=true&status=publish&orderby=date&order=desc&per_page=3`.
- API EN: `/wp-json/wp/v2/posts?cat=tin-tuc&lang=en&_embed=true&status=publish&orderby=date&order=desc&per_page=3`.
- Astro đọc nguồn API từ ESC Table thay vì gọi `getPosts()` hardcode cho `home_05`, hiển thị card động theo các bài publish mới nhất. ACF `product_lang.value` đã được hỗ trợ.
- WordPress CMS configuration [#42434417432](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42434417432): SUCCESS.
- Production build [#42435170160](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42435170160): SUCCESS.
- Visual Builder release / build and verify [#42435077686](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42435077686): SUCCESS.
- Real production Playwright API-vs-UI test [#42435408490](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42435408490): SUCCESS; `PTSCPS_HOME05_LIVE_QA_PASS=1 count_vi=3 count_en=3 api_source=ESC_TABLE`. Đã so sánh title, link, thứ tự bài và nguồn section.
- Astro `ptscps-astro/master`: `cf943f991e3cef685b56e2989333c813a00123ca`.
- PHP `ptscps-php/master` giữ nguyên: `fcdb935f439ad9d5358b660e8d901aeff9fea383`.
- Actions workflow/QA source: `0794964faa3e89fc5e29836d80e664ed849715e8` (trước commit checkpoint).
- Đã sửa lỗi build ban đầu `LOCALE_MIXED_CONTENT` và build lại thành công; bản lỗi không được deploy.

**Chế độ code:** `auto-build`
**Cổng ghi source:** `source-commit-actions`
