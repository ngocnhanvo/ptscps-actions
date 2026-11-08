# ChatGPT — latest response

- Date: 2026-11-08, Asia/Ho_Chi_Minh
- Project: ptscps.com.vn
- Repository: ngocnhanvo/ptscps-actions
- Branch: main
- Status: DONE — native Services Pages Visual Builder deployed and verified

## Response

### Hoàn tất WordPress Page + ESC Table cho menu DỊCH VỤ

- Knowledge rule: `knowledge/main@98a466ca`, `stacks/wordpress-page-esc-category-sources.md`. WordPress Page sở hữu shortcode và section, ESC Table giữ nội dung; ProductCategory là dữ liệu tham chiếu readonly.
- Trang tổng `/dich-vu`: Page `82755`, ESC Table `services_00_vi` dùng `meta.api=ProductCategory`. Không tạo category giả `Tất cả`.
- Bốn Page con: `85614` FPSO/FSO/MOPU; `85617` thiết kế/mua sắm; `85620` nhân lực; `85623` sửa chữa/bảo dưỡng. WordPress Page thật, `IntroPage`, `ssr-service`, `product_lang=vi`, shortcode `pub_service_<slug>` tương ứng. Setup [#42455603659](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42455603659) PASS.
- Astro production `ptscps-astro/master@3e4ee8005d2ab51d0f0fc14ac9b7594962e7e1ce`: hỗ trợ native Page Preview render ESC Table, cập nhật Page qua REST. PHP production `ptscps-php/master@aa6bbea429d41e4bae2595ba38b44a015648ecd3`: cho phép sửa bảng gắn shortcode đúng Page con, vẫn khóa Page giả/sai slug/parent. Guarded release [#42459103868](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42459103868) PASS.
- Read-only QA [#42458273852 attempt 2](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42458273852): 4/4 Page đúng identity, REST `editable-text` HTTP 200, Inspector chọn cell đúng, không ghi CMS.
- Guarded Save/REST/Reload/Restore QA [#42459957204](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42459957204) PASS 4/4: tất cả 4 cell `content` lưu qua Visual Builder, đọc lại REST và Preview sau reload đúng, khôi phục nguyên giá trị; `temporaryRecordsRemaining=0`.
- Những field lấy trực tiếp từ Product/ProductCategory vẫn readonly về giá trị taxonomy, cần sửa dữ liệu gốc trong WordPress; không coi chúng là cell ESC Table. QA xác nhận bốn cell thực tế, không suy mọi field/API đều sửa được.

**Chế độ code:** `auto-build`
**Cổng ghi source:** `source-commit-actions`
**Trạng thái:** `DONE — hoàn tất`
