# 百度 / 搜狗 收录操作清单

> 目标：让两个中文搜索引擎**发现并抓取**本站。前置条件：站点已能被抓（robots 允许、sitemap 可访问、页面服务端直出）。

## 0. 已经就绪的部分（不用再动）

| 项 | 状态 |
|---|---|
| `robots.txt` | 动态生成，`Allow: /`，屏蔽 `/d/`、`/api/`，声明 sitemap |
| `sitemap.xml` | 动态生成，8 条 URL，带 `lastmod` |
| 页面 | 服务端直出 HTML（不依赖 JS），`/about` + 5 篇 `/guide/*` 覆盖长尾词 |
| 语言标注 | `<html lang="zh-CN">`，`<meta name="description">` 独立 |
| 结构数据 | `WebApplication` / `Article` / `FAQPage` / `BreadcrumbList` |

## 1. 百度搜索资源平台

1. 打开 <https://ziyuan.baidu.com/site/index>，登录。
2. **添加网站** → 输入 `https://sixdrop.dev`（选 `https://`，不要带 www）。
3. 验证方式选 **HTML 标签**，复制 `content` 的值（形如 `codeva-xxxxxxxx`）。
4. 把这个值发给维护者，执行：
   ```bash
   node tools/set-verify.mjs baidu=codeva-xxxxxxxx
   ```
   然后 `wrangler deploy --config wrangler.prod.jsonc`，回到平台点 **完成验证**。
5. 验证通过后：
   - **数据引入 → 链接提交 → sitemap**：提交 `https://sixdrop.dev/sitemap.xml`。
   - **数据引入 → 链接提交 → API 提交**：复制 token，然后：
     ```bash
     BAIDU_TOKEN=你的token node tools/ping-search.mjs
     ```
     输出里的 `success` 是成功条数，`remain` 是当天剩余配额；`not_valid` / `not_same_site` 说明被拒原因。
6. 顺手设置：**站点属性**（站点名称、logo）、**抓取诊断**（手动抓一次首页，看状态码）。

## 2. 搜狗站长平台

1. 打开 <https://zhanzhang.sogou.com/>，登录。
2. **添加网站** → `https://sixdrop.dev`。
3. 验证方式选 **HTML 标签**，复制验证码，执行：
   ```bash
   node tools/set-verify.mjs sogou=验证码
   ```
   部署后回平台点 **验证**。
4. 验证通过后：**资源提交 → sitemap 提交**，填 `https://sixdrop.dev/sitemap.xml`。
5. 搜狗的资质审核通常需要几个工作日，期间保持站点可访问即可。

## 3. 验证是否生效（不需要登录）

```bash
# 页面里能看到验证 meta
curl -s https://sixdrop.dev/ | grep -i "site-verification"

# 搜索引擎身份访问首页（应 200，且不是验证码/挑战页）
curl -s -o /dev/null -w "%{http_code}\n" -A "Baiduspider" https://sixdrop.dev/
curl -s -o /dev/null -w "%{http_code}\n" -A "Sogou web spider" https://sixdrop.dev/

# sitemap / robots
curl -s https://sixdrop.dev/sitemap.xml | grep -c "<loc>"
curl -s https://sixdrop.dev/robots.txt
```

## 4. 之后 7 天看什么

| 指标 | 在哪看 | 期望 |
|---|---|---|
| 抓取频次 | 百度：数据监控 → 抓取频次 | 有 Baiduspider 的请求 |
| 索引量 | 百度：数据监控 → 索引量 | 从 0 开始涨 |
| 抓取异常 | 百度：数据监控 → 抓取异常 | 没有 4xx/5xx 堆积 |
| 收录查询 | `site:sixdrop.dev`（百度/搜狗） | 出现首页或 /guide |

如果 7 天后一条 Baiduspider 都没有：

1. 先查 Cloudflare **Security Events** 有没有拦它（UA 白名单/托管规则）；
2. 再看百度的 **抓取诊断** 返回什么（连接超时 / 403 / 5xx）；
3. 确认没有给 `/` 加过 `noindex` 或 `x-robots-tag`（只有 `/d/` 有，这是对的）。

## 5. 不要做的事

- 不要买「快速收录」「秒收录」——百度 2024 年就下线了快速收录工具，现在只有 API 配额。
- 不要重复提交同一批旧 URL（浪费当天配额）。
- 不要给同一个 URL 做多个镜像域名（canonical 已经指向主域，镜像只会分权）。
- 不要短时间内堆大量外部链接（新站容易触发异常）。
